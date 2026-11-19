#!/usr/bin/env python3
"""scripts/check_links_test.py — the link check reads a docs/ page's relative links."""

import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import check_links  # noqa: E402


def errors(page_line):
    with tempfile.TemporaryDirectory() as root:
        cwd = os.getcwd()
        os.chdir(root)
        try:
            Path("design.md").write_text("# The design\n\n## Open\n", encoding="utf-8")
            Path("page.html").write_text(page_line + "\n", encoding="utf-8")
            return list(check_links.link_errors("page.html", 1, page_line))
        finally:
            os.chdir(cwd)


class PageLinks(unittest.TestCase):
    def test_a_page_link_to_a_missing_file_is_reported(self):
        """A relative href to a file that does not exist is a LINK error."""
        self.assertEqual(len(errors('<a href="evidence/missing.md">x</a>')), 1)

    def test_a_page_link_to_a_missing_heading_is_reported(self):
        """A relative href to a heading the Markdown file does not have is an ANCHOR error."""
        self.assertEqual(len(errors('<a href="design.md#decided">x</a>')), 1)

    def test_resolving_and_external_page_links_pass(self):
        """A resolving href, an in-page fragment and an external URL raise nothing."""
        self.assertEqual(errors('<a href="design.md#open">x</a> <a href="#p-none">y</a> <a href="https://x.org/a">z</a>'), [])

    def test_the_client_design_page_is_checked(self):
        """The gate's file list holds the docs/ pages, the client's design page among them."""
        os.chdir(check_links.ROOT)
        self.assertIn("docs/client/design.html", check_links.checked_files())


if __name__ == "__main__":
    unittest.main()
