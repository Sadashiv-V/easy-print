from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import ServiceError
from app.models.accounts import User
from app.models.documents import Document
from app.models.pricing import PricingRule
from app.services.audit import log_event


def current_rule(db: Session) -> PricingRule:
    rule = db.scalar(select(PricingRule).order_by(PricingRule.id.desc()).limit(1))
    if not rule:
        raise ServiceError(503, "Pricing has not been configured yet")
    return rule


def rate_for(rule: PricingRule, color_mode: str) -> int:
    return rule.color_paise_per_page if color_mode == "color" else rule.bw_paise_per_page


def estimate_paise(doc: Document, rule: PricingRule) -> int:
    return doc.selected_pages * rate_for(rule, doc.color_mode) * doc.copies


def set_pricing(
    db: Session, *, actor: User, bw_paise: int, color_paise: int, reason: str, ip: Optional[str]
) -> PricingRule:
    old = current_rule(db)
    rule = PricingRule(
        bw_paise_per_page=bw_paise, color_paise_per_page=color_paise, created_by=actor.id, reason=reason
    )
    db.add(rule)
    db.flush()
    log_event(
        db,
        action="admin.pricing_change",
        actor_id=actor.id,
        target_type="pricing",
        target_id=str(rule.id),
        reason=reason,
        ip=ip,
        detail={
            "bw": [old.bw_paise_per_page, bw_paise],
            "color": [old.color_paise_per_page, color_paise],
        },
    )
    db.commit()
    return rule
