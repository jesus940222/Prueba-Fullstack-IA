import os

from alembic import context
from sqlalchemy import engine_from_config, pool

from portal_ai.infrastructure.clients import sqlalchemy_url

config = context.config
raw_url = os.environ.get("AI_DATABASE_URL", "").strip()
if raw_url == "":
    raise SystemExit("invalid_environment:AI_DATABASE_URL")

section = dict(config.get_section(config.config_ini_section) or {})
section["sqlalchemy.url"] = sqlalchemy_url(raw_url)


def run_migrations_online() -> None:
    connectable = engine_from_config(section, prefix="sqlalchemy.", poolclass=pool.NullPool)
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=None)
        with context.begin_transaction():
            context.run_migrations()


run_migrations_online()
