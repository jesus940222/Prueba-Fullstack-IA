"""AI business tables. Checkpoints stay free of session tokens."""

revision = "20261021_0002"
down_revision = "20261021_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS ai_records (
          collection text NOT NULL,
          record_id text NOT NULL,
          document jsonb NOT NULL,
          PRIMARY KEY (collection, record_id)
        )
        """
    )


def downgrade() -> None:
    from alembic import op

    op.execute("DROP TABLE IF EXISTS ai_records")
