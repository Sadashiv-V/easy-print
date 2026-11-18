import smtplib
from email.mime.text import MIMEText

from app.core.config import GMAIL_PASS, GMAIL_USER


def send_otp_email(to_email: str, otp: str, college_id: str) -> None:
    """Send a password-reset OTP via Gmail SMTP.
    Raises RuntimeError if email is not configured.
    """
    if not GMAIL_USER or not GMAIL_PASS:
        raise RuntimeError("Email is not configured on this server.")

    subject = "Easy-Print Password Reset OTP"
    body = (
        f"Hi {college_id},\n\n"
        f"Your OTP to reset your Easy-Print password is:\n\n"
        f"    {otp}\n\n"
        f"This OTP is valid for 10 minutes. Do not share it with anyone.\n\n"
        f"If you did not request this, ignore this email.\n\n"
        f"— Easy-Print"
    )

    msg = MIMEText(body)
    msg["Subject"] = subject
    msg["From"] = GMAIL_USER
    msg["To"] = to_email

    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as smtp:
        smtp.login(GMAIL_USER, GMAIL_PASS)
        smtp.sendmail(GMAIL_USER, to_email, msg.as_string())