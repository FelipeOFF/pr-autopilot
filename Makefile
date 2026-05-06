SKILL_NAME := pr-autopilot
GLOBAL_DIR := $(HOME)/.claude/skills/$(SKILL_NAME)

.PHONY: help sync diff dry-run uninstall check

help:
	@echo "pr-autopilot — development tasks"
	@echo ""
	@echo "  make sync        Install/update the skill into ~/.claude/skills/$(SKILL_NAME)/"
	@echo "  make diff        Show diff between this repo's SKILL.md and the installed one"
	@echo "  make dry-run     Show what 'make sync' would do without doing it"
	@echo "  make uninstall   Remove the global install (does NOT touch this repo)"
	@echo "  make check       Validate SKILL.md frontmatter"

sync:
	@bash scripts/sync-to-global.sh

dry-run:
	@bash scripts/sync-to-global.sh --dry-run

diff:
	@bash scripts/sync-to-global.sh --diff

uninstall:
	@rm -rf "$(GLOBAL_DIR)"
	@echo "Removed $(GLOBAL_DIR)"

check:
	@head -1 SKILL.md | grep -q '^---$$' || (echo "FAIL: SKILL.md missing front-matter" && exit 1)
	@grep -q '^name: $(SKILL_NAME)$$' SKILL.md || (echo "FAIL: name mismatch" && exit 1)
	@grep -q '^argument-hint:' SKILL.md || (echo "FAIL: missing argument-hint" && exit 1)
	@echo "✅ SKILL.md frontmatter looks valid"
