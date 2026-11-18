from alembic import context

import app.models.accounts  # noqa: F401
import app.models.audit  # noqa: F401
import app.models.documents  # noqa: F401
import app.models.pricing  # noqa: F401
import app.models.wallet  # noqa: F401
import app.models.stations  # noqa: F401
import app.models.jobs  # noqa: F401
from app.core.config import DATABASE_URL
from app.core.db import Base, engine

target_metadata = Base.metadata
_is_sqlite = DATABASE_URL.startswith("sqlite")


def run_migrations_offline() -> None:
    context.configure(
        url=DATABASE_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=_is_sqlite,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    with engine.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=_is_sqlite,
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()