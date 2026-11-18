"""Easy-Print print agent. Runs on the station PC, next to the printer.

Setup (Windows):
  1. python -m pip install -r requirements.txt
  2. Check everything first (prints nothing):
       python print_agent.py --server https://YOUR-DOMAIN/api --key AGENT_KEY --printer "Printer Name" --check
  3. Print a test page (colour + both sides) to see the printer obeys the settings:
       python print_agent.py --server https://YOUR-DOMAIN/api --key AGENT_KEY --printer "Printer Name" --test-page --test-color --test-duplex
  4. Run for real (leave the window open):
       python print_agent.py --server https://YOUR-DOMAIN/api --key AGENT_KEY --printer "Printer Name"

Engines: "gdi" (default) renders the pages itself and sends them through Windows printing.
"sumatra" uses SumatraPDF instead (python print_agent.py ... --engine sumatra).
Use --dry-run to test everything except the physical printing (add --preview-dir DIR to save page images).
"""
import argparse
import importlib
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path
from typing import List, Optional, Tuple

import httpx

try:
    import win32print  # type: ignore
except ImportError:
    win32print = None

SUMATRA_CANDIDATES = [
    r"C:\Program Files\SumatraPDF\SumatraPDF.exe",
    r"C:\Program Files (x86)\SumatraPDF\SumatraPDF.exe",
    os.path.expandvars(r"%LOCALAPPDATA%\SumatraPDF\SumatraPDF.exe"),
]

MAX_RENDER_DPI = 300
_PART_RE = re.compile(r"(\d+)(?:-(\d+))?")


def log(msg: str) -> None:
    print(f"{time.strftime('%H:%M:%S')}  {msg}", flush=True)


def select_pages(spec: str, page_count: int) -> List[int]:
    """'1-3,5' -> [0, 1, 2, 4]. Same rules as the server; 'all' selects every page."""
    spec = (spec or "all").strip().lower()
    if spec in ("", "all"):
        return list(range(page_count))
    chosen = set()
    for part in spec.replace(" ", "").split(","):
        m = _PART_RE.fullmatch(part)
        if not m:
            raise RuntimeError(f"Unreadable page selection '{part}'")
        start, end = int(m.group(1)), int(m.group(2) or m.group(1))
        if start < 1 or end < start or end > page_count:
            raise RuntimeError(f"Page selection is outside the document ({page_count} pages)")
        chosen.update(range(start - 1, end))
    return sorted(chosen)


def fit_page(page, width: int, height: int, color: bool, dpi: int):
    """Renders one PDF page, rotated if needed, scaled to fit width x height device pixels.
    Returns (image, target_width, target_height) where the target is the size to draw at."""
    pw, ph = page.get_size()
    rotation = 90 if (pw > ph) != (width > height) else 0
    if rotation:
        pw, ph = ph, pw
    fit = min(width / pw, height / ph)
    target_w, target_h = max(1, int(pw * fit)), max(1, int(ph * fit))
    cap = min(1.0, MAX_RENDER_DPI / max(dpi, 1))
    bitmap = page.render(scale=fit * cap, rotation=rotation, may_draw_forms=False)
    img = bitmap.to_pil()
    img = img.convert("RGB") if color else img.convert("L")
    return img, target_w, target_h


def printer_state(printer: Optional[str]) -> Tuple[str, Optional[str]]:
    """Maps Windows printer flags to what the server understands."""
    if win32print is None:
        return "online", None
    try:
        name = printer or win32print.GetDefaultPrinter()
        handle = win32print.OpenPrinter(name)
        try:
            info = win32print.GetPrinter(handle, 2)
        finally:
            win32print.ClosePrinter(handle)
    except Exception as exc:
        return "error", f"Printer not found: {str(exc)[:60]}"
    status, attrs = info["Status"], info["Attributes"]
    if status & 0x80 or attrs & 0x400:
        return "offline", "Printer is offline"
    if status & 0x10:
        return "no_paper", "Out of paper"
    if status & 0x40000:
        return "error", "Out of toner"
    if status & 0x8:
        return "error", "Paper jam"
    if status & (0x2 | 0x400000 | 0x100000):
        return "error", "Printer needs attention"
    return "online", None


def wait_for_spooler(printer: Optional[str], timeout: int = 180) -> None:
    """Waits until Windows has handed the job to the printer; raises if the queue shows an error."""
    if win32print is None:
        return
    try:
        name = printer or win32print.GetDefaultPrinter()
        handle = win32print.OpenPrinter(name)
    except Exception:
        return
    try:
        deadline = time.time() + timeout
        while time.time() < deadline:
            jobs = win32print.EnumJobs(handle, 0, -1, 1)
            if not jobs:
                return
            for job in jobs:
                if job["Status"] & (0x2 | 0x40 | 0x20 | 0x4000):
                    raise RuntimeError("The printer reported an error while printing")
            time.sleep(1)
        raise RuntimeError("Printing took too long")
    finally:
        win32print.ClosePrinter(handle)


# ---------------------------------------------------------------- engines


class GdiEngine:
    """Renders pages with pdfium and prints them through the Windows print system."""

    name = "gdi"

    def __init__(self, printer: Optional[str]):
        try:
            self.pdfium = importlib.import_module("pypdfium2")
            self.win32print = importlib.import_module("win32print")
            self.win32ui = importlib.import_module("win32ui")
            self.win32gui = importlib.import_module("win32gui")
            self.win32con = importlib.import_module("win32con")
            self.ImageWin = importlib.import_module("PIL.ImageWin")
        except ImportError as exc:
            raise RuntimeError(f"Missing package ({exc.name}). Run: python -m pip install -r requirements.txt") from exc
        self.printer = printer or self.win32print.GetDefaultPrinter()

    def capabilities(self) -> Tuple[bool, bool]:
        """(can print colour, can print both sides) as reported by the driver."""
        handle = self.win32print.OpenPrinter(self.printer)
        try:
            port = self.win32print.GetPrinter(handle, 2)["pPortName"]
        finally:
            self.win32print.ClosePrinter(handle)
        dc = self.win32print.DeviceCapabilities
        return bool(dc(self.printer, port, 32)), bool(dc(self.printer, port, 7))  # DC_COLORDEVICE, DC_DUPLEX

    def _devmode(self, color: bool, duplex: bool):
        w = self.win32con
        handle = self.win32print.OpenPrinter(self.printer)
        try:
            dm = self.win32print.GetPrinter(handle, 2)["pDevMode"]
            if dm is None:
                raise RuntimeError("The printer driver gave no settings to change")
            dm.Fields |= w.DM_COLOR | w.DM_DUPLEX | w.DM_COPIES
            dm.Color = w.DMCOLOR_COLOR if color else w.DMCOLOR_MONOCHROME
            dm.Duplex = w.DMDUP_VERTICAL if duplex else w.DMDUP_SIMPLEX
            dm.Copies = 1
            try:
                self.win32print.DocumentProperties(0, handle, self.printer, dm, dm, w.DM_IN_BUFFER | w.DM_OUT_BUFFER)
            except Exception as exc:
                log(f"  note: driver did not validate settings ({exc})")
        finally:
            self.win32print.ClosePrinter(handle)
        return dm

    def _check(self, color: bool, duplex: bool) -> None:
        can_color, can_duplex = self.capabilities()
        if color and not can_color:
            raise RuntimeError("This printer cannot print in colour")
        if duplex and not can_duplex:
            raise RuntimeError("This printer cannot print on both sides")

    def _print_images(self, frames, color: bool, duplex: bool, title: str) -> None:
        """frames: iterable of callables (width, height, dpi) -> (image, target_w, target_h)."""
        hdc = self.win32gui.CreateDC("WINSPOOL", self.printer, self._devmode(color, duplex))
        dc = self.win32ui.CreateDCFromHandle(hdc)
        started = False
        try:
            dc.StartDoc(title)
            started = True
            width, height = dc.GetDeviceCaps(self.win32con.HORZRES), dc.GetDeviceCaps(self.win32con.VERTRES)
            dpi = dc.GetDeviceCaps(self.win32con.LOGPIXELSX)
            for make in frames:
                img, tw, th = make(width, height, dpi)
                x, y = (width - tw) // 2, (height - th) // 2
                dc.StartPage()
                self.ImageWin.Dib(img).draw(dc.GetHandleOutput(), (x, y, x + tw, y + th))
                dc.EndPage()
            dc.EndDoc()
            started = False
        finally:
            if started:
                try:
                    dc.AbortDoc()
                except Exception:
                    pass
            dc.DeleteDC()

    def print_item(self, path: Path, item: dict) -> None:
        color, duplex = item["color_mode"] == "color", bool(item["duplex"])
        self._check(color, duplex)
        pdf = self.pdfium.PdfDocument(str(path))
        try:
            pages = select_pages(item["page_ranges"], len(pdf))
            if len(pages) != item["selected_pages"]:
                raise RuntimeError("Page count does not match what was charged. Not printed.")
            for copy in range(item["copies"]):
                frames = [(lambda w, h, d, i=i: fit_page(pdf[i], w, h, color, d)) for i in pages]
                self._print_images(frames, color, duplex, f"Easy-Print {item['document_name'][:60]}")
        finally:
            pdf.close()
        wait_for_spooler(self.printer)

    def print_test_page(self, color: bool, duplex: bool) -> None:
        from PIL import Image, ImageDraw  # type: ignore

        def page(side: str):
            def make(w, h, dpi):
                img = Image.new("RGB" if color else "L", (1240, 1754), "white")
                d = ImageDraw.Draw(img)
                d.rectangle((60, 60, 1180, 1694), outline=(0, 0, 0) if color else 0, width=6)
                d.text((120, 140), f"Easy-Print test page ({side})", fill=(0, 0, 0) if color else 0)
                d.text((120, 190), f"Printer: {self.printer}", fill=(0, 0, 0) if color else 0)
                swatches = [(0, 166, 200), (224, 36, 108), (242, 183, 5), (0, 0, 0)]
                for n, rgb in enumerate(swatches):
                    d.rectangle((120 + n * 250, 300, 340 + n * 250, 520), fill=rgb if color else int(sum(rgb) / 3))
                scale = min(w / 1240, h / 1754)
                return img, int(1240 * scale), int(1754 * scale)
            return make

        self._check(color, duplex)
        self._print_images([page("front"), page("back")] if duplex else [page("front")], color, duplex, "Easy-Print test page")
        wait_for_spooler(self.printer)


def sumatra_settings(item: dict) -> str:
    parts = []
    if item["page_ranges"] != "all":
        parts.append(item["page_ranges"])
    if item["copies"] > 1:
        parts.append(f"{item['copies']}x")
    parts.append("color" if item["color_mode"] == "color" else "monochrome")
    parts.append("duplexlong" if item["duplex"] else "simplex")
    return ",".join(parts)


def find_sumatra(explicit: Optional[str]) -> Optional[str]:
    for path in [explicit] + SUMATRA_CANDIDATES:
        if path and Path(path).exists():
            return path
    return shutil.which("SumatraPDF")


class SumatraEngine:
    name = "sumatra"

    def __init__(self, printer: Optional[str], exe: Optional[str]):
        self.printer = printer
        self.exe = find_sumatra(exe)
        if not self.exe:
            raise RuntimeError("SumatraPDF not found. Install it or pass --sumatra PATH")

    def print_item(self, path: Path, item: dict) -> None:
        target = ["-print-to", self.printer] if self.printer else ["-print-to-default"]
        cmd = [self.exe, *target, "-print-settings", sumatra_settings(item), "-silent", str(path)]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        if result.returncode != 0:
            raise RuntimeError(f"SumatraPDF failed (code {result.returncode})")
        wait_for_spooler(self.printer)


def preview_item(path: Path, item: dict, outdir: Path) -> None:
    """Dry-run helper: renders exactly the pages that would print, onto A4 at 100 dpi, as PNG files."""
    pdfium = importlib.import_module("pypdfium2")
    pdf = pdfium.PdfDocument(str(path))
    try:
        pages = select_pages(item["page_ranges"], len(pdf))
        if len(pages) != item["selected_pages"]:
            raise RuntimeError("Page count does not match what was charged")
        outdir.mkdir(parents=True, exist_ok=True)
        for n, i in enumerate(pages, 1):
            img, _, _ = fit_page(pdf[i], 827, 1169, item["color_mode"] == "color", 100)
            img.save(outdir / f"item{item['id']}_page{n}_of_{len(pages)}.png")
    finally:
        pdf.close()


def erase(path: Path) -> None:
    try:
        size = path.stat().st_size
        with open(path, "r+b") as f:
            f.write(b"\0" * size)
    except OSError:
        pass
    path.unlink(missing_ok=True)


# ---------------------------------------------------------------- agent


class Agent:
    def __init__(self, args):
        self.args = args
        self.client = httpx.Client(base_url=args.server.rstrip("/"), headers={"X-Agent-Key": args.key}, timeout=30)
        self.engine = None
        if not args.dry_run:
            self.engine = SumatraEngine(args.printer, args.sumatra) if args.engine == "sumatra" else GdiEngine(args.printer)

    def heartbeat(self) -> Tuple[str, Optional[str]]:
        status, message = ("online", None) if self.args.dry_run else printer_state(self.args.printer)
        self.client.post("/agent/printer-status", json={"status": status, "message": message}).raise_for_status()
        return status, message

    def report(self, job_id: int, item_id: int, status: str, reason: Optional[str] = None) -> None:
        for attempt in range(3):
            try:
                self.client.post(
                    f"/agent/jobs/{job_id}/items/{item_id}/result", json={"status": status, "reason": reason}
                ).raise_for_status()
                return
            except httpx.HTTPError as exc:
                log(f"  could not report result (attempt {attempt + 1}): {exc}")
                time.sleep(2)

    def process(self, job: dict) -> None:
        log(f"Order {job['id']}: {len(job['items'])} file(s)")
        workdir = Path(tempfile.mkdtemp(prefix="easyprint_agent_"))
        try:
            for item in job["items"]:
                path = workdir / f"{uuid.uuid4().hex}.pdf"
                try:
                    resp = self.client.get(f"/agent/jobs/{job['id']}/items/{item['id']}/file")
                    resp.raise_for_status()
                    path.write_bytes(resp.content)
                    if self.args.simulate_fail and self.args.simulate_fail.lower() in item["document_name"].lower():
                        raise RuntimeError("Simulated printer failure")
                    if self.args.dry_run:
                        log(f"  [dry-run] would print file {item['id']}: {item['selected_pages']} page(s), {sumatra_settings(item)}")
                        if self.args.preview_dir:
                            preview_item(path, item, Path(self.args.preview_dir))
                    else:
                        self.engine.print_item(path, item)
                    self.report(job["id"], item["id"], "done")
                    log(f"  file {item['id']}: done")
                except Exception as exc:
                    log(f"  file {item['id']}: FAILED - {exc}")
                    self.report(job["id"], item["id"], "failed", str(exc)[:180])
                finally:
                    erase(path)
        finally:
            shutil.rmtree(workdir, ignore_errors=True)

    def run(self) -> None:
        engine = "dry run" if self.args.dry_run else self.engine.name
        log(f"Agent started ({engine}). Polling every {self.args.poll}s.")
        last_state = None
        while True:
            try:
                state = self.heartbeat()
                if state != last_state:
                    log(f"Printer: {state[0]}{' - ' + state[1] if state[1] else ''}")
                    last_state = state
                resp = self.client.post("/agent/claim")
                if resp.status_code == 200:
                    self.process(resp.json())
                    continue
                resp.raise_for_status()
                if self.args.once:
                    return
            except httpx.HTTPError as exc:
                log(f"Server problem: {exc}. Retrying...")
            time.sleep(self.args.poll)

    def check(self) -> int:
        ok = True
        try:
            status, message = self.heartbeat()
            log(f"Server reachable, agent key accepted. Printer status: {status}{' - ' + message if message else ''}")
            ok = ok and status == "online"
        except httpx.HTTPError as exc:
            log(f"PROBLEM: cannot reach the server or key rejected: {exc}")
            return 1
        if self.engine is not None:
            log(f"Engine: {self.engine.name}")
            if isinstance(self.engine, GdiEngine):
                try:
                    can_color, can_duplex = self.engine.capabilities()
                    log(f"Printer '{self.engine.printer}': colour {'yes' if can_color else 'NO'}, both sides {'yes' if can_duplex else 'NO'}")
                except Exception as exc:
                    log(f"PROBLEM: could not read printer abilities: {exc}")
                    ok = False
            if win32print is None:
                log("Note: pywin32 not installed, so printer status and jam detection are limited.")
        return 0 if ok else 1


def main() -> int:
    p = argparse.ArgumentParser(description="Easy-Print print agent")
    p.add_argument("--server", default=os.environ.get("EASYPRINT_SERVER", "http://127.0.0.1:8000"))
    p.add_argument("--key", default=os.environ.get("EASYPRINT_AGENT_KEY"), help="Agent key from the admin")
    p.add_argument("--printer", default=os.environ.get("EASYPRINT_PRINTER"), help="Printer name (default: Windows default)")
    p.add_argument("--engine", choices=["gdi", "sumatra"], default=os.environ.get("EASYPRINT_ENGINE", "gdi"))
    p.add_argument("--sumatra", default=os.environ.get("EASYPRINT_SUMATRA"), help="Path to SumatraPDF.exe (sumatra engine)")
    p.add_argument("--poll", type=int, default=3, help="Seconds between checks")
    p.add_argument("--dry-run", action="store_true", help="Do everything except physical printing")
    p.add_argument("--preview-dir", help="With --dry-run: save the pages that would print as PNG files here")
    p.add_argument("--once", action="store_true", help="Exit when the queue is empty (for testing)")
    p.add_argument("--check", action="store_true", help="Test the setup and exit")
    p.add_argument("--test-page", action="store_true", help="Print a test page and exit (needs no server)")
    p.add_argument("--test-color", action="store_true", help="With --test-page: print in colour")
    p.add_argument("--test-duplex", action="store_true", help="With --test-page: print on both sides")
    p.add_argument("--simulate-fail", help="Fail any file whose name contains this text (for demos)")
    args = p.parse_args()

    if args.test_page:
        try:
            engine = GdiEngine(args.printer)
            engine.print_test_page(args.test_color, args.test_duplex)
        except Exception as exc:
            print(f"Test page failed: {exc}")
            return 1
        print(f"Test page sent to '{engine.printer}'. Check what came out: colour={args.test_color}, both sides={args.test_duplex}.")
        return 0

    if not args.key:
        print("An agent key is required (--key or EASYPRINT_AGENT_KEY).")
        return 2
    try:
        agent = Agent(args)
    except RuntimeError as exc:
        print(f"PROBLEM: {exc}")
        return 1
    if args.check:
        return agent.check()
    try:
        agent.run()
    except KeyboardInterrupt:
        log("Stopped.")
    return 0


if __name__ == "__main__":
    sys.exit(main())