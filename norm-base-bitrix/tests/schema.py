"""Small stdlib-only SQLite schema/actual retrieval SQL test; does NOT execute PHP."""
import pathlib
import re
import sqlite3
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


class SchemaTest(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        sql = (ROOT / "migrations/001.sql").read_text(encoding="utf-8")
        self.db.executescript(sql)
        self.db.executescript(sql)  # idempotent
        self.db.execute("INSERT INTO documents VALUES(1,'Акт','now',1)")
        self.version(1, "2026-01-01", "2026-12-31")
        self.db.execute("INSERT INTO provisions VALUES(1,1,'п. 1','Точная цитата','2026-02-01','2026-03-01')")
        php = (ROOT / "src/Consultant.php").read_text(encoding="utf-8")
        self.query = re.search(r'\$s->rows\("(SELECT.*?)", array_fill', php, re.S).group(1)

    def tearDown(self):
        self.db.close()

    def version(self, id_, start, end, status="ready"):
        self.db.execute(
            """INSERT INTO versions(id,document_id,original_name,stored_name,extension,
            sha256,bytes,status,effective_from,effective_to,created_at,created_by)
            VALUES(?,1,'a.pdf',?,'pdf','hash',1,?,?,?,'now',1)""",
            (id_, str(id_) + ".blob", status, start, end),
        )

    def matches(self, day):
        return self.db.execute(self.query, [day] * 6).fetchall()

    def test_inclusive_boundaries(self):
        for day, count in [("2026-01-31", 0), ("2026-02-01", 1),
                           ("2026-03-01", 1), ("2026-03-02", 0)]:
            self.assertEqual(len(self.matches(day)), count)

    def test_overlap_is_not_latest_upload(self):
        self.version(2, "2026-02-01", None)
        self.assertEqual(self.matches("2026-02-10"), [])

    def test_unreviewed_version_cannot_ground_ai(self):
        self.db.execute("UPDATE versions SET status='pending_review'")
        self.assertEqual(self.matches("2026-02-10"), [])

    def test_foreign_keys(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO provisions VALUES(2,999,'п.2','text','2026-01-01',NULL)")


if __name__ == "__main__":
    unittest.main()
