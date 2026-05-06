# pr-autopilot

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Claude Code Skill](https://img.shields.io/badge/Claude%20Code-Skill-7c3aed)](https://docs.claude.com/en/docs/claude-code)
[![Plataformas](https://img.shields.io/badge/plataformas-GitHub%20%7C%20GitLab-blue)]()

> 🇺🇸 [Read in English](./README.md)

Uma [skill do Claude Code](https://docs.claude.com/en/docs/claude-code/skills) que orquestra o **ciclo de vida completo de um Pull Request** com múltiplos subagentes coordenados.

**Criação → Review → Resposta → Re-review → CI → Merge.** Sem intervenção manual.

---

## O que ela faz

`pr-autopilot` transforma o ritual longo e manual de um PR em um único comando. Ela instancia um subagente **Reviewer** que audita seu diff, um subagente **Author** que age sobre os achados, faz o ciclo até o review aprovar, monitora a pipeline e dá merge.

```
┌──────────────────────────────────────────────────────────────┐
│  pr-autopilot (orquestrador)                                 │
│                                                              │
│  ① Preflight + criação do PR                                 │
│        │                                                     │
│  ② Subagente Reviewer  ──► review-report.md                  │
│        │                                                     │
│  ③ Subagente Author    ──► response-summary.md  + commits    │
│        │                                                     │
│  ④ Loop até APPROVED ou max-iterations                       │
│        │                                                     │
│  ⑤ Polling dos checks de CI                                  │
│        │                                                     │
│  ⑥ Auto-merge (squash / merge / rebase)                      │
└──────────────────────────────────────────────────────────────┘
```

## Funcionalidades

- **Título e descrição automáticos** baseados em commits e diff, seguindo Conventional Commits + Jira.
- **Loop de review multi-agente** com achados estruturados: `BLOCKER`, `SUGGESTION`, `NITPICK`, `APPROVED`.
- **Author com poder de veto** — pode refutar um BLOCKER incorreto com evidência ao invés de aplicar cegamente.
- **Gates de verificação** — lint, type-check e testes precisam continuar verdes antes de qualquer push.
- **Polling de CI** com backoff adaptativo, timeout configurável e logs reais de falha trazidos ao usuário.
- **Estado resumível** — todo artefato é persistido em `.pr-autopilot/<PR>/`. Re-executar continua do ponto certo.
- **GitHub e GitLab** prontos de fábrica (`gh` / `glab`).
- **Seguro por padrão** — nunca `--no-verify`, nunca `--force`, nunca auto-resolve conflito.

## Requisitos

| Ferramenta | Para quê |
|------------|----------|
| [Claude Code](https://docs.claude.com/en/docs/claude-code) | Runtime do agente |
| `git` | Obrigatório |
| [`gh`](https://cli.github.com/) | Repos no GitHub |
| [`glab`](https://gitlab.com/gitlab-org/cli) | Repos no GitLab |
| `jq` | Usado em algumas chamadas |

## Instalação

A skill é um único arquivo Markdown. Coloque no diretório de skills do Claude Code:

```bash
# Usuário (disponível em todos os projetos)
mkdir -p ~/.claude/skills/pr-autopilot
curl -o ~/.claude/skills/pr-autopilot/SKILL.md \
  https://raw.githubusercontent.com/FelipeOFF/pr-autopilot/main/SKILL.md

# OU por projeto
mkdir -p .claude/skills/pr-autopilot
cp SKILL.md .claude/skills/pr-autopilot/
```

Pronto — o Claude Code descobre na próxima sessão.

## Modos

Você escolhe um dos quatro modos:

| Modo | Como invocar | O que acontece |
|------|--------------|----------------|
| **Só PR** | `/pr-autopilot --review=false` | Cria o PR, espera o CI, dá merge |
| **PR + review** | `/pr-autopilot --review=true --resolve=false` | Cria o PR, posta o review **inline** linha a linha, para |
| **PR + review + resolve** *(padrão)* | `/pr-autopilot` | Cria o PR, review inline, o Author responde inline + commita fixes, loop, merge no CI verde |
| **Auto (totalmente hands-off)** | `/pr-autopilot --auto` | Igual ao padrão, mas explícito: nunca pergunta nada. Espera **todos** os checks de CI. Só faz merge quando tudo está verde. Aborta a qualquer falha. |

`--auto` é abreviação para "faça tudo sozinho, mas nunca dê merge se algum teste estiver falhando." Não relaxa nenhum guardrail.

## Uso

De qualquer branch com commits para enviar:

```bash
# Totalmente autônomo: review + resolve + espera CI + merge
/pr-autopilot --auto

# Padrão: review + resolve + merge
/pr-autopilot

# Cria o PR, posta o review inline, para (humano resolve)
/pr-autopilot --review=true --resolve=false

# Pula o review, só cria e merge automático
/pr-autopilot --review=false

# Para antes do merge (revisão humana final)
/pr-autopilot --no-merge

# Auto mode com loop maior e merge via rebase
/pr-autopilot --auto --max-iterations=3 --merge-strategy=rebase

# PR como draft (apenas criação)
/pr-autopilot --draft
```

### Flags

| Flag | Padrão | Descrição |
|------|--------|-----------|
| `--auto` | `false` | Hands-off total: review + resolve + espera CI + merge. Nunca pergunta. |
| `--review` | `true` | Roda o subagente Reviewer (comentários inline) |
| `--resolve` | `true` | Roda o subagente Author (respostas inline + fixes) |
| `--max-iterations` | `2` | Máximo de ciclos review→resposta |
| `--merge-strategy` | `squash` | `squash` \| `merge` \| `rebase` |
| `--base` | auto | Branch alvo |
| `--draft` | `false` | Abre como draft (sem merge) |
| `--no-merge` | `false` | Para após aprovação |
| `--ci-timeout` | `1800` | Segundos antes de desistir do CI |
| `--ci-poll-interval` | `30` | Intervalo entre polls |

### Review inline e respostas inline

O Reviewer **nunca** posta um comentário único agregado no PR. Cada achado vai como comentário inline no arquivo e linha exatos, com tag de severidade:

- `[BLOCKER]` — precisa ser corrigido antes do merge
- `[SUGGESTION]` — provavelmente deveria ser corrigido
- `[NITPICK]` — opcional

O Author responde em cada comentário inline com uma de:

- `✅ FIXED in <sha>` — o código foi alterado
- `🛑 REFUTED` — o achado está errado, com evidência no código
- `⏸ DEFERRED` — reconhecido, follow-up planejado
- `🤷 SKIPPED` — só permitido em NITPICKs

O orquestrador valida que nenhum BLOCKER fica `DEFERRED`/`SKIPPED`.

Referência completa no [`SKILL.md`](./SKILL.md).

## Como os agentes se comunicam

O orquestrador nunca deixa os agentes conversarem diretamente. Eles se comunicam por **artefatos Markdown tipados** com YAML front-matter, escritos em `.pr-autopilot/<PR>/iter-<N>/`:

- `review-report.md` — produzido pelo Reviewer. Contém `verdict`, `blocker_count`, lista de achados.
- `response-summary.md` — produzido pelo Author. Contém ação por achado (`FIXED`, `REFUTED`, `DEFERRED`), SHA dos commits e resultado da verificação.

O orquestrador faz parsing do front-matter e decide a próxima fase. Cada passo é **inspecionável, repetível e resumível.**

## Segurança

- **Nunca contorna hooks.** Sem `--no-verify`, sem `--no-gpg-sign`.
- **Nunca faz force-push.** Conflito de push interrompe o loop e mostra o diff.
- **Nunca resolve conflito de merge automaticamente.** Para e pergunta.
- **Verificação antes do push.** O Author se recusa a empurrar se lint/types/testes regrediram.
- **BLOCKER nunca é ignorado em silêncio.** Ou é corrigido, ou refutado com evidência concreta.

Modelo de ameaças completo e canal de reporte: veja [SECURITY.md](./SECURITY.md).

## Saída no terminal

```
[mode] --auto (hands-off total)
[1/6] PR #482 criado → https://github.com/acme/api/pull/482
[2/6] Reviewer iter 1 → CHANGES_REQUESTED (2 BLOCKER, 3 SUGGESTION) — 5 comentários inline postados
[3/6] Author iter 1   → 2 corrigidos, 1 adiado, respostas postadas, push abc1234
[2/6] Reviewer iter 2 → APPROVED
[5/6] CI: aguardando… 2/4 pendentes
[5/6] CI: 4/4 checks verdes
[6/6] Merge (squash) → main @ def5678
```

## Contribuindo

Issues e PRs são bem-vindos. Leia [CONTRIBUTING.md](./CONTRIBUTING.md) antes.

## Licença

[MIT](./LICENSE)
