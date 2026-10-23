import sys

from alembic import command
from alembic.config import Config

from portal_ai.infrastructure.config import load_config
from portal_ai.infrastructure.qdrant.provision import provision


def main() -> None:
    config = load_config()
    command.upgrade(Config("alembic.ini"), "head")
    provision(config.qdrant_url, config.vector_size)
    sys.stdout.write('{"applied":"head"}\n')


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as error:
        sys.stderr.write(f"migration_failed:{type(error).__name__}\n")
        raise SystemExit(1) from None
