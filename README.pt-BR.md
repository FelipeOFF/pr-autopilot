# pr-autopilot

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Claude Code Skill](https://img.shields.io/badge/Claude%20Code-Skill-7c3aed)](https://docs.claude.com/en/docs/claude-code)
[![Plataformas](https://img.shields.io/badge/plataformas-GitHub%20%7C%20GitLab-blue)]()

> 🇺🇸 [Read in English](./README.md)

Uma [skill do Claude Code](https://docs.claude.com/en/docs/claude-code/skills) que orquestra o **ciclo de vida completo de um Pull Request** com múltiplos subagentes coordenados.

**Criação → Review → Triagem de todo comentário → Resposta → Re-review → Resolve conflitos & corrige CI → Espera CI → Merge.** Sem intervenção manual.

**Opt-in por padrão.** Todo estágio fica desligado até você pedir. O `pr-autopilot` puro só abre o PR e para. Você liga cada estágio com uma flag (`--review`, `--resolve`, `--merge`) ou liga todos de uma vez com `--auto`. `--cascade` é um opt-in separado: IDs (ou "these tickets") enviam uma floresta de PRs empilhados a partir do tracker deste repo (reusa PR aberto; falha para a floresta); sem IDs, num PR stacked, percorre essa cadeia até o trunk. Itens independentes são raízes contra o trunk; um filho bloqueado empilha no head do parent. `--auto` não liga isso.

---

## O que ela faz

`pr-autopilot` transforma o ritual longo e manual de um PR em um único comando. Ela instancia um subagente **Reviewer** que audita seu diff e um subagente **Author** que limpa tudo que está entre a branch e um merge limpo: todo comentário que já existe no PR (seu, dos colegas, do Copilot, do CodeRabbit, do Sonar), conflitos de merge e CI vermelho. Faz o loop até o PR ficar verde e então dá merge.

**O Reviewer executa duas trilhas paralelas** quando `--review` ou `--auto` é acionado: (A) uma **trilha de código** — carrega [`thermo-nuclear-code-quality-review`](https://github.com/cursor/plugins/tree/main/cursor-team-kit/skills/thermo-nuclear-code-quality-review) via ferramenta Skill para auditoria profunda de manutenibilidade: code judo, qualidade de abstração, tamanho de arquivo (<1k → >1k é um smell), crescimento de spaghetti, simplificação estrutural. Esta é a barra de aprovação: não aprove apenas porque o comportamento funciona. Poucos comentários de alta convicção; sem enxurrada de nits. (B) uma **trilha de testes** — avaliação de valor de testes que avalia testes no diff do PR por valor e sinaliza candidatos para remoção (tautologias, testes sempre-verdes, custo injustificado). Dois ranqueadores independentes avaliam os testes, um consolidador reconcilia os achados, e o orquestrador mescla todos os achados em uma única review postada no PR. Quando o diff não contém testes, apenas a trilha de código é executada.

Duas coisas ele não faz sozinho. Quando a mudança mexe numa **regra de negócio**, o Author para e confirma o comportamento pretendido com você antes, via a skill [`groom-me`](https://github.com/FelipeOFF/skills/tree/main/skills/groom-me). E quando o CI está vermelho por algo anterior à sua branch, ele nunca contorna a falha — pergunta antes de escrever "esse pipeline está quebrado por outro motivo" no seu PR, e diz isso uma vez, nunca duas.

```
┌──────────────────────────────────────────────────────────────┐
│  pr-autopilot (orquestrador)                                 │
│                                                              │
│  ① Preflight + criação do PR                                 │
│        │                                                     │
│  ② Subagente Reviewer  ──► review-report.md                  │
│        │                                                     │
│  ③ Subagente Author    ──► pr-feedback.md + response-summary │
│        │      tria TODO comentário do PR (humano + bot),      │
│        │      corrige, resolve conflitos, atribui e conserta  │
│        │      o CI  (regra de negócio → groom-me antes)       │
│  ④ Loop até APPROVED ou max-iterations                       │
│        │                                                     │
│  ⑤ Polling dos checks de CI  (vermelho + --resolve → volta ③)│
│        │                                                     │
│  ⑥ Auto-merge — só com --merge / --auto                      │
└──────────────────────────────────────────────────────────────┘
```

Os estágios ②–⑥ são opt-in. Sem nenhuma flag, a execução termina depois do ①.

## Funcionalidades

- **Estágios opt-in** — toda flag tem default `false`. O `pr-autopilot` puro abre o PR e para; você liga review, resolve e merge conforme precisar.
- **Título e descrição automáticos** baseados em commits e diff, seguindo Conventional Commits + Jira.
- **`--show-me` briefing para o revisor** — opt-in. Anexa uma seção `## What this PR does` na descrição do PR (mermaid / file tree / call tree / diff em markdown, nunca HTML) para o revisor humano ler o que a mudança faz, o trade-off e a alternativa que não entrou, antes do diff. Combinado com `--review`, cada finding do Reviewer também ganha um **comment view** nas mesmas quatro formas, na mesma linha do achado; o marcador de severidade continua por último. Combinado com `--resolve`, cada resposta do Author numa thread que ainda não tem resposta, e um comentário de triagem de CI postado, também ganham exatamente um comment view; threads já tratadas e NOISE ficam sem resposta. `--auto` não liga isso. Uma segunda execução troca a seção em vez de duplicar. Com `--resolve`, a seção regenera depois de um push do Author que de fato mudou o diff. O Author não escreve a seção visual do PR.
- **`--show-me-comments` operator briefing** — opt-in. Imprime markdown na conversa do harness para cada comentário que já existe no PR: `path:line` quando o comentário é inline, a observação citada, e um **comment view** (mermaid / file tree / call tree / diff em markdown, nunca HTML). Comentários de topo omitem a linha de path. Não é postado no PR. Não é um HTML local. `--auto` não liga isso. Sem `--resolve`, a execução faz o briefing e para (depois do review postado, se `--review` também rodou). Com `--resolve`, o briefing vem depois do inventário e antes do Author mexer no código. `--auto` ou sem TTY grava `.pr-autopilot/<PR>/operator-briefing.md` e continua. Se `show-me` não carregar: o mesmo alerta + `npx skills add FelipeOFF/skills --skill=show-me` do `--show-me`; sem briefing inventado.
- **`--cascade` floresta de work items, ou uma cadeia existente** — opt-in. Escolhe o source do tracker neste repo ou nos IDs do prompt (GitHub se origin for GitHub, GitLab se GitLab, beads se `.beads/` existir, Jira só com um projeto do repo ou `PROJ-123` no prompt). MCP instalado globalmente não é source. `#9` / `PROJ-12` / um id `bd` escolhem o source sem perguntar. Dois sources, zero sources, ou um prompt que é só o ID de um spec: pergunta uma vez; com `--auto`, para. Tickets Cairn são beads. Sem arquivo de config de tracker. Implementa work items como uma floresta de PRs. Itens independentes são raízes contra o trunk (`--base`, ou o default do repo). Um filho empilha só quando Blocked-by / blocking nativo diz isso; a host base é o head do PR parent, não o trunk. Serial: o PR do parent existe antes de cortar o filho. Um PR aberto do work item é reutilizado (restack no head do parent ou no trunk se a base estiver errada); um segundo PR não é aberto. Uma falha para a floresta: raízes independentes posteriores ficam pending, e a árvore lista opened / failed / pending. O próximo item só começa se os estágios pedidos do atual terminaram sem halt. O body do filho tem `Stacked on: #<parent> (merge after)` e fecha o work item filho, não a spec. Graph mode ignora o feature branch atual. IDs no prompt vencem mesmo se o PR atual estiver stacked. Sem IDs e a base do PR atual ≠ trunk: existing-chain — percorre trunk → … → este PR; irmãos ficam fora do path. `--cascade` não liga `--merge`. Com `--merge` ou `--auto`, o path aterra bottom-up: a raiz no trunk primeiro, depois o próximo PR (existing-chain: ancestrais mais o atual, não irmãos). Um dangling child é retargetado no trunk; o trunk entra no feature com `git merge` (sem force-push); a verificação roda de novo; então o merge segue se ainda foi pedido. `--draft` continua a proibir merge. Um `CHANGES_REQUESTED` humano em pé ainda bloqueia o merge daquele PR. `--auto` não liga isso. Uma frase como "cascade these tickets" liga. `ready-for-human` é pulado a menos que o ID tenha sido nomeado. `--title` / `--body` não são carimbados no PR do work item; em existing-chain valem só no PR atual.
- **Loop de review multi-agente** com achados estruturados: `BLOCKER`, `SUGGESTION`, `NITPICK`, `APPROVED`.
- **Author com poder de veto** — pode refutar um BLOCKER incorreto com evidência ao invés de aplicar cegamente.
- **Escreve como gente, codifica como sênior preguiçoso** — cada palavra postada no PR passa pela [`humanizer`](https://github.com/FelipeOFF/skills/tree/main/skills/humanizer) e cada linha de código pela [`ponytail`](https://github.com/FelipeOFF/skills/tree/main/skills/ponytail). Sem carimbo `✅ FIXED`, sem colchete `[BLOCKER]`, sem emoji de abertura: o comentário parece escrito por um colega, e o estado de máquina viaja num marcador HTML invisível. As duas skills também estão reescritas dentro da própria skill, então um harness sem elas se comporta igual.
- **`--unslop` segundo passe de prosa** — opt-in. Depois do humanizer, a prosa postada (título e body gerados, achados do Reviewer, respostas do Author, um comentário de triagem de CI) passa pela [`unslop`](https://github.com/cursor/plugins/tree/main/pstack/skills/unslop) na voz de quem invocou: a conta GitHub ou GitLab desta execução, amostrada nos comentários que essa conta já deixou neste repo. Sem amostra → primeira pessoa, sem arquivo de voz. `--auto` não liga isso. Se a skill estiver ausente, a execução alerta com `npx skills add https://github.com/cursor/plugins --skill=unslop` e segue só com humanizer — nunca finge o passe.
- **Revisa over-engineering, não só bug** — o Reviewer carrega a lente ponytail: abstração com um único caller, dependência adicionada por três linhas, helper reimplementado quando o repo já tem um. "Apaga isso" é um achado válido.
- **Lê todo comentário do PR, não só os dele** — com `--resolve`, o Author puxa comentários inline, comentários de topo e vereditos de review de humanos *e* de bots (Copilot, CodeRabbit, Sonar), classifica cada um (crítica / pergunta / ruído / já tratado), infere a severidade e responde inline em cada um, em linguagem de gente, com o marcador invisível carregando o estado. As respostas que ele mesmo deixou são lidas como estado, então ele nunca entra em loop respondendo a si mesmo.
- **Resolve o PR inteiro** — com `--resolve`/`--auto`, o Author também resolve **conflitos de merge** (fazendo merge da base no feature branch, sem force-push) e **corrige o CI falhando** (lê os logs, corrige o código, roda a verificação de novo, dá push).
- **Atribui a falha de CI antes de encostar nela** — checa se o arquivo que quebrou está no seu diff, se a mesma job falha na branch base e em outros PRs abertos, e se o log mostra secret faltando ou timeout de rede. O que quebrou por sua causa é corrigido. O que quebrou por causa alheia nunca é maquiado com teste pulado ou pin aleatório.
- **Só diz "o problema não é do meu PR" com a sua permissão** — e uma vez só. Antes de postar esse comentário ele pergunta, mostrando o texto exato; procura o próprio marcador `<!-- pr-autopilot:ci-triage:<check> -->` para que um re-run nunca poste duas vezes; e em `--auto` fica calado e te entrega o texto pronto.
- **Guardrail de regra de negócio** — antes de um comentário, uma resolução de conflito ou uma correção de CI mudar o que o software decide, permite, bloqueia ou cobra, o Author confirma o comportamento pretendido com você via a skill [`groom-me`](https://github.com/FelipeOFF/skills/tree/main/skills/groom-me). Um revisor *pedindo* a mudança é a entrada dessa conversa, não um substituto dela. Ele nunca entrega em silêncio uma decisão que você não tomou.
- **Gates de verificação** — lint, type-check e testes precisam continuar verdes antes de qualquer push.
- **Polling de CI** com backoff adaptativo, timeout configurável e logs reais de falha trazidos ao usuário.
- **Estado resumível** — todo artefato é persistido em `.pr-autopilot/<PR>/`. Re-executar continua do ponto certo.
- **GitHub e GitLab** prontos de fábrica (`gh` / `glab`).
- **Seguro por padrão** — nunca `--no-verify`, nunca um `--force` cego, nunca uma mudança silenciosa de regra de negócio.

## Requisitos

| Ferramenta | Para quê |
|------------|----------|
| [Claude Code](https://docs.claude.com/en/docs/claude-code) | Runtime do agente |
| `git` | Obrigatório |
| [`gh`](https://cli.github.com/) | Repos no GitHub |
| [`glab`](https://gitlab.com/gitlab-org/cli) | Repos no GitLab |
| `jq` | Usado em algumas chamadas |

## Instalação

### Recomendado — um comando com `npx`

```bash
# Instalação no usuário (disponível em todos os projetos)
npx github:FelipeOFF/pr-autopilot

# Instalação no projeto (só neste repo)
npx github:FelipeOFF/pr-autopilot --project

# Outras ações
npx github:FelipeOFF/pr-autopilot --dry-run     # mostra o que seria escrito
npx github:FelipeOFF/pr-autopilot --uninstall   # remove a cópia instalada
npx github:FelipeOFF/pr-autopilot --help
```

O installer copia o `SKILL.md` para `~/.claude/skills/pr-autopilot/`
(ou `./.claude/skills/pr-autopilot/` com `--project`). Depois de instalar,
rode `/reload-plugins` dentro do Claude Code (ou reinicie a sessão) para a
skill ser carregada.

### Com a CLI `skills` — `npx skills add`

Se você usa a CLI [`skills`](https://www.npmjs.com/package/skills)
(`vercel-labs/skills`), dá pra adicionar a skill direto do GitHub:

```bash
# Instalação no nível do projeto (./.claude/skills/) — é o padrão
npx skills add FelipeOFF/pr-autopilot

# Instalação no nível do usuário (~/.claude/skills/, vale em todo projeto)
npx skills add FelipeOFF/pr-autopilot -g

# Gerenciar skills instaladas
npx skills list                 # lista as skills instaladas
npx skills update pr-autopilot  # baixa o SKILL.md mais recente
npx skills update               # atualiza toda skill gerenciada pela CLI
npx skills remove pr-autopilot  # desinstala
```

O `npx skills add` baixa o repo e linka o `SKILL.md` no diretório de skills.
Como a CLI rastreia o que instala, o `npx skills update` consegue atualizar
depois no lugar — diferente de uma cópia manual. Como nos outros métodos, rode
`/reload-plugins` dentro do Claude Code depois para o `/pr-autopilot` aparecer.

### Manual (sem Node)

```bash
# Usuário
mkdir -p ~/.claude/skills/pr-autopilot
curl -o ~/.claude/skills/pr-autopilot/SKILL.md \
  https://raw.githubusercontent.com/FelipeOFF/pr-autopilot/main/SKILL.md

# OU por projeto
mkdir -p .claude/skills/pr-autopilot
cp SKILL.md .claude/skills/pr-autopilot/
```

Ao começar a digitar `/pr-autopilot` no Claude Code, as flags disponíveis
(`--auto`, `--review`, `--resolve`, `--merge`, `--show-me`, `--show-me-comments`, `--unslop`, `--cascade`, `--draft`, …) aparecem
inline graças ao `argument-hint` declarado no front-matter da skill — mesmo
padrão usado pelo GSD. `--auto` não implica `--cascade`.

## Workflow de desenvolvimento

Este repositório **é** o código-fonte da skill. Clone, itere no `SKILL.md`,
depois sincronize para o diretório global do Claude Code:

```bash
git clone https://github.com/FelipeOFF/pr-autopilot.git
cd pr-autopilot

make check       # valida o front-matter do SKILL.md
make dry-run     # mostra o que seria instalado
make sync        # instala/atualiza ~/.claude/skills/pr-autopilot/
make diff        # diff entre SKILL.md do repo e a cópia instalada
make uninstall   # remove a instalação global
```

Depois do `make sync`, rode `/reload-plugins` dentro do Claude Code (ou
reinicie a sessão) para a skill atualizada ser carregada.

## Modos

Tudo é opt-in — componha as flags que você quiser (cada uma tem default `false`):

| Modo | Como invocar | O que acontece |
|------|--------------|----------------|
| **Só PR** *(padrão, sem flags)* | `/pr-autopilot` | Cria o PR, imprime a URL, para. Nada mais roda. |
| **PR + merge** | `/pr-autopilot --merge` | Cria o PR, espera o CI, dá merge. Sem review. |
| **PR + review** | `/pr-autopilot --review` | Cria o PR, posta o review **inline**, para |
| **Resolver o que já está lá** | `/pr-autopilot --resolve` | Pula o review da IA. O Author tria todo comentário que já existe no PR — humano e bot — corrige o que é acionável, resolve conflitos, corrige o CI, para antes do merge |
| **Review + resolve** | `/pr-autopilot --review --resolve` | Cria o PR, posta o review inline, e o Author **sempre** roda — mesmo se esse review for APPROVED — nesse review *mais* todo o resto do PR, loop, para antes do merge (adicione `--merge` para dar merge) |
| **Auto (totalmente hands-off)** | `/pr-autopilot --auto` | Tudo ligado, nunca pergunta. Resolve conflitos e corrige o CI. Espera **todos** os checks de CI. Só faz merge quando tudo está verde. Aborta ou escala em qualquer guardrail. **Não** liga `--cascade`. |
| **Cascade** | `/pr-autopilot --cascade` | IDs → uma floresta de work items. Reusa um PR aberto; uma falha para a floresta. Sem IDs e a base do PR atual ≠ trunk → existing-chain (path até este PR; irmãos ficam de fora). Itens independentes são raízes contra o trunk. Um filho bloqueado empilha no head do parent. O feature branch atual não é o parent. Não liga `--merge`. Com `--merge` / `--auto`, aterra bottom-up (raiz no trunk primeiro). `--auto` não liga isso. |

Observações:

- `--resolve` é independente de `--review`. Sozinha, trabalha o feedback que o PR já tem sem acrescentar um review próprio — é o modo para um PR que um humano já revisou. Combinada com `--review`, o Author ainda roda depois de um veredito APPROVED (inventário, checagem de conflito, atribuição de CI). Um quiet pass ainda imprime `conflict: none` e `CI: green`.
- `--merge` é o que habilita o merge; sem ele (ou `--auto`) a execução sempre para antes do merge.
- `--auto` é abreviação para `--review --resolve --merge` mais "nunca me pergunte nada" — mas nunca relaxa um guardrail: testes falhando, um conflito em regra de negócio, um BLOCKER aberto ou um check vermelho abortam ou escalam.
- `--auto` **não** liga `--show-me`, `--unslop`, `--show-me-comments` nem `--cascade`. Essas continuam opt-in. Uma frase como "cascade these tickets" liga `--cascade`; `--auto` não liga.
- Não perguntar significa não ter consentimento. O que exige o seu sim explícito — mudar uma regra de negócio, ou comentar que o CI está vermelho por causa alheia ao PR — vira `escalated` no `--auto`, nunca é feito em silêncio.

## Uso

De qualquer branch com commits para enviar:

```bash
# Padrão (sem flags): abre o PR e para
/pr-autopilot

# Totalmente autônomo: review + resolve (comentários + conflitos + CI) + espera CI + merge
/pr-autopilot --auto

# Cria e faz auto-merge no CI verde, sem review
/pr-autopilot --merge

# Abre o PR, posta o review inline, para (humano resolve)
/pr-autopilot --review

# Trabalha o feedback que o PR já tem (colegas, Copilot, CodeRabbit) + conflitos
# + CI, sem postar um review novo da IA
/pr-autopilot --resolve

# Posta um review primeiro, depois resolve ele e todo o resto
/pr-autopilot --review --resolve

# Resolve o feedback existente + merge no CI verde
/pr-autopilot --resolve --merge

# Auto mode com loop menor e merge via rebase
/pr-autopilot --auto --max-iterations=3 --merge-strategy=rebase

# PR como draft (apenas criação)
/pr-autopilot --draft

# Briefing para o revisor na descrição (--auto não implica isso)
/pr-autopilot --show-me

# Briefing na descrição, mais um comment view em cada finding do Reviewer
/pr-autopilot --show-me --review

# Briefing na criação; um comment view em cada reply ainda sem resposta e
# no comentário de triagem de CI postado; regenera a seção depois de
# fixes do Author que mudam o diff
/pr-autopilot --show-me --resolve

# Operator briefing dos comentários que já existem no PR (--auto não implica isso)
/pr-autopilot --show-me-comments

# Review, depois briefing desses findings mais o que já estava no PR, e para
/pr-autopilot --show-me-comments --review

# Briefing depois do inventário, então o Author trata os findings
/pr-autopilot --show-me-comments --resolve

# Hands-off total: grava .pr-autopilot/<PR>/operator-briefing.md e continua
/pr-autopilot --auto --show-me-comments

# Segundo passe de prosa depois do humanizer (--auto não implica isso)
/pr-autopilot --unslop

# Unslop nos achados do Reviewer
/pr-autopilot --unslop --review

# Unslop nas respostas do Author
/pr-autopilot --unslop --resolve

# Hands-off total mais unslop em toda prosa postada que o auto já escreve
/pr-autopilot --auto --unslop

# Floresta de work items contra o trunk. Source neste repo ou nos IDs.
# Sem IDs e PR atual stacked: existing-chain (path até este PR).
# (--auto não implica isso)
/pr-autopilot --cascade

# A mesma flag via frase: cascade these tickets

# IDs nomeados: graph mode mesmo se o PR atual estiver stacked
/pr-autopilot --cascade #9 #10 #11 #12
/pr-autopilot --cascade PROJ-12

# Sem IDs, PR atual stacked em outro PR: existing-chain.
# Percorre trunk → … → este PR. Irmãos ficam fora do path. Sem merge
# a menos que --merge / --auto.
/pr-autopilot --cascade

# Merge bottom-up: raiz no trunk primeiro, depois o próximo PR
/pr-autopilot --cascade --merge

# Drafts podem abrir; nenhum dá merge
/pr-autopilot --cascade --draft --merge

# Compõe review / visual / draft em cada PR enviado (graph)
# ou só no PR atual (existing-chain). Ainda sem merge.
/pr-autopilot --cascade --review --show-me --draft
```

### Flags

Toda flag booleana tem default `false` — passe-a (pura, ou `=true`) para ligar o estágio.

| Flag | Padrão | Descrição |
|------|--------|-----------|
| `--auto` | `false` | Hands-off total: liga `--review`, `--resolve`, `--merge`, nunca pergunta, resolve conflitos + corrige CI. **Não** liga `--show-me` nem `--cascade`. |
| `--review` | `false` | Roda o subagente Reviewer (comentários inline) |
| `--resolve` | `false` | Roda o subagente Author — sempre, mesmo quando o Reviewer aprovou. Tria todo comentário que já existe no PR (humano e bot), corrige o que é acionável, resolve conflitos, corrige CI. **Não** implica `--review`. |
| `--merge` | `false` | Habilita o auto-merge no CI verde + `MERGEABLE`. Sem ela a execução para antes do merge. `--cascade` não liga isso. |
| `--max-iterations` | `2` | Máximo de ciclos review→resposta (e correção de CI) |
| `--merge-strategy` | `squash` | `squash` \| `merge` \| `rebase` |
| `--base` | auto | Branch alvo. Sob `--cascade`, é o trunk que o PR raiz aponta. |
| `--draft` | `false` | Abre como draft (força sem merge) |
| `--show-me` | `false` | Anexa (ou troca) um briefing para o revisor na descrição do PR. Combinado com `--review`, também coloca um comment view em cada finding do Reviewer. Combinado com `--resolve`, também coloca um comment view em cada reply do Author ainda sem resposta e num comentário de triagem de CI postado. `--auto` não liga. |
| `--show-me-comments` | `false` | Imprime um operator briefing dos comentários que já existem no PR (observação citada + um comment view; `path:line` quando inline). Não é postado. `--auto` não liga. |
| `--unslop` | `false` | Depois do humanizer, passa a prosa postada pelo unslop na voz de quem invocou. `--auto` não liga. |
| `--cascade` | `false` | Opt-in. IDs ou "these tickets": uma floresta. Reutiliza um PR aberto do work item (restack se a base estiver errada). Uma falha para a floresta. Sem IDs e a base do PR atual ≠ trunk: existing-chain, o path do trunk até este PR; irmãos ficam fora do path. Itens independentes são raízes contra o trunk. Um filho bloqueado empilha no head do PR parent. Não liga `--merge`. Com `--merge` ou `--auto`, aterra bottom-up. `--auto` não implica. Uma frase como "cascade these tickets" liga. |
| `--ci-timeout` | `1800` | Segundos antes de desistir do CI |
| `--ci-poll-interval` | `30` | Intervalo entre polls |

### Review inline e respostas inline

O Reviewer **nunca** posta um comentário único agregado no PR. Cada achado vai como comentário inline no arquivo e linha exatos. Ele abre com as palavras que um revisor fala em voz alta — `Blocking:`, `Suggestion:`, `nit:` — e fecha com um marcador invisível que carrega a severidade para o pipeline. Com `--show-me --review`, o mesmo comentário também carrega exatamente um **comment view** (mermaid / file tree / call tree / diff em markdown, nunca HTML) acima do marcador. Sem `--show-me`, os findings ficam só em prosa.

```html
<!-- pr-autopilot:severity=blocker -->
```

O Author responde em cada comentário inline em linguagem normal, e fecha a resposta com o marcador de ação. Com `--show-me --resolve`, cada reply numa thread que ainda não tem resposta, e um comentário de triagem de CI postado, também carregam exatamente um comment view acima do marcador. Sem `--show-me`, as replies ficam só em prosa. Uma thread que já tem marcador de ação (ou um reply antigo com carimbo de status) fica sem segunda resposta — nem reply novo, nem view nova. NOISE fica sem reply. O Author não escreve a seção visual do PR.

```html
<!-- pr-autopilot:action=fixed sha=abc1234 -->   o código foi alterado
<!-- pr-autopilot:action=refuted -->             o achado está errado, com evidência no código
<!-- pr-autopilot:action=deferred -->            reconhecido, follow-up planejado
<!-- pr-autopilot:action=skipped -->             só permitido em NITPICKs
<!-- pr-autopilot:action=answered -->            era uma pergunta; respondida, nada a mudar
```

O humano lê uma frase; o pipeline lê o marcador. É isso que evita que o PR pareça um formulário preenchido por robô sem o orquestrador perder de vista o que aconteceu com cada achado — e é o que deixa a próxima iteração distinguir uma thread já tratada de uma nova.

O orquestrador valida que nenhum BLOCKER fica `deferred`/`skipped` — inclusive os BLOCKERs inferidos de um `CHANGES_REQUESTED` humano. Um bloqueio humano em aberto nunca é ultrapassado, por mais verde que o CI esteja.

Comentários vindos de um humano ou de outro bot recebem o mesmo tratamento. Eles chegam sem marcador de severidade, então o Author infere uma: comentário ligado a um review `CHANGES_REQUESTED`, ou que aponta bug, falha de segurança, perda de dados ou contrato quebrado, é `BLOCKER`; o que estiver marcado como "nit" ou "opcional" é `NITPICK`; o resto cai em `SUGGESTION`. Ele nunca rebaixa um achado que um humano usou para bloquear o PR.

### Conflitos & CI (com `--resolve` / `--auto`)

Além dos comentários, o Author também limpa tudo o mais que bloqueia um merge limpo:

- **Conflitos de merge** — faz merge da base no feature branch, resolve cada arquivo (lendo o código, o histórico do git e a memória compartilhada para decisões anteriores), commita e dá push. Sem reescrever histórico, sem force-push.
- **CI falhando, atribuído primeiro** — antes de encostar em qualquer coisa, o Author decide de quem é a falha. O arquivo que quebrou está no diff deste PR? A mesma job falha na branch base, ou em outros PRs abertos agora? O log mostra secret faltando, 5xx de registry, OOM do runner? Um veredito `unknown` conta como *seu* — ele investiga o próprio diff em vez de culpar o pipeline.
  - **É seu** → causa-raiz pelo log, reproduz local quando o comando é óbvio, corrige o código, roda lint/type/test de novo, commita, dá push. Loop até `--max-iterations`.
  - **Não é seu** → ele nunca maquia. Sem teste pulado, sem pin aleatório, sem retry cego, sem editar o workflow. Em vez disso, oferece comentar no PR: primeiro procura o próprio marcador `<!-- pr-autopilot:ci-triage:<check> -->` para que o ponto seja feito uma vez e nunca repetido, depois pergunta a você — mostrando o texto exato — e posta só com um sim explícito. Em `--auto` ou em execução não-interativa, não posta nada e te entrega o comentário redigido.
- **Guardrail de regra de negócio** — se agir num comentário, resolver um conflito ou corrigir o CI for mudar um `if`/validação/threshold/preço/permissão ou qualquer decisão de domínio, o Author pausa e confirma o comportamento pretendido com você através da skill [`groom-me`](https://github.com/FelipeOFF/skills/tree/main/skills/groom-me) antes de mexer. Um revisor pedindo a mudança não a autoriza — o comentário dele é o que começa essa conversa. Numa execução não-interativa, registra o item como escalado e para, ao invés de chutar.

Referência completa no [`SKILL.md`](./SKILL.md).

## Como os agentes se comunicam

O orquestrador nunca deixa os agentes conversarem diretamente. Eles se comunicam por **artefatos Markdown tipados** com YAML front-matter, escritos em `.pr-autopilot/<PR>/iter-<N>/`:

- `review-report.md` — produzido pelo Reviewer. Contém `verdict`, `blocker_count`, lista de achados. Ausente quando `--resolve` roda sem `--review`.
- `pr-feedback.md` — produzido pelo Author antes de escrever qualquer código. O inventário de todo comentário que já existe no PR: autor, origem, classe, severidade inferida e se mexe em regra de negócio.
- `operator-briefing.md` — produzido pelo orquestrador quando `--show-me-comments` roda sob `--auto` ou sem TTY. Markdown só do harness com os comentários que já existem no PR; nunca postado.
- `response-summary.md` — produzido pelo Author. Contém ação por achado (`FIXED`, `REFUTED`, `DEFERRED`, `ANSWERED`), status de conflito, atribuição de CI por check, SHA dos commits e resultado da verificação. Esses arquivos são estado de máquina e nunca vão para o PR, por isso mantêm o vocabulário em caixa alta que os comentários abandonaram.

O orquestrador faz parsing do front-matter e decide a próxima fase. Cada passo é **inspecionável, repetível e resumível.**

## Segurança

- **Nunca contorna hooks.** Sem `--no-verify`, sem `--no-gpg-sign`.
- **Nunca faz force-push cego.** Conflitos são resolvidos fazendo merge da base no feature branch (sem reescrever histórico). O único force permitido é `--force-with-lease` no branch de *feature* quando você escolheu explicitamente `--merge-strategy=rebase` — nunca em um branch protegido.
- **Nunca muda uma regra de negócio em silêncio.** Um comentário, conflito ou correção de CI que mexe numa decisão de domínio passa pelo `groom-me` para sua confirmação primeiro.
- **Nunca fala por você no PR sem perguntar.** Alegar que um check vermelho é culpa de outro é um ato social com custo. O Author pergunta antes, te mostra o texto exato, checa o próprio marcador para nunca postar duas vezes, e fica calado no `--auto`.
- **Nunca maquia um pipeline quebrado.** Uma falha que ele não causou nunca vira verde pulando teste, fixando dependência ao acaso ou editando o workflow.
- **Verificação antes do push.** O Author se recusa a empurrar se lint/types/testes regrediram.
- **BLOCKER nunca é ignorado em silêncio.** Ou o problema é corrigido, ou o Author o refuta com evidência concreta.
- **Nunca faz merge por cima de um check vermelho.** Checks obrigatórios falhando abortam a execução (ou disparam uma correção sob `--resolve`), nunca um merge.

Modelo de ameaças completo e canal de reporte: veja [SECURITY.md](./SECURITY.md).

## Saída no terminal

```
[mode] --auto (hands-off total)
[1/6] PR #482 criado → https://github.com/acme/api/pull/482
[1/6] PR visual section appended
[2/6] Reviewer iter 1 → CHANGES_REQUESTED (2 BLOCKER, 3 SUGGESTION) — 5 comentários inline postados
[3/6] Author iter 1   → 12 comentários triados (7 acionáveis, 3 ruído, 2 já tratados)
[3/6] Author iter 1   → 2 corrigidos, 1 adiado, 1 respondido, respostas postadas, push abc1234
[3/6] PR visual section replaced
[3/6] Author iter 1   → conflito em pricing.ts resolvido (merge da base, groom-me confirmou) def5678
[3/6] conflict: resolved
[3/6] CI: not-run
[2/6] Reviewer iter 2 → APPROVED
[3/6] Author iter 2   → 12 comentários triados (0 acionáveis, 3 ruído, 9 já tratados)
[3/6] conflict: none
[3/6] CI: green
[5/6] CI: aguardando… 2/4 pendentes
[5/6] CI: unit falhou → atribuído a este PR → assert flaky corrigido, push 9ab0cd1
[5/6] CI: e2e falhou → atribuído à main (falha em 77f2a1c também) → perguntou, comentário postado
[5/6] CI: 4/4 checks verdes
[6/6] Merge (squash) → main @ ef01234
```

A linha `[mode]` reflete as flags que você passou — `Só PR (sem flags)`, `--merge`, `--review`, `--resolve`, `--show-me-comments`, `--unslop` ou `--auto`. Os estágios que não rodam no seu modo simplesmente não aparecem — exceto as linhas `conflict:` e `CI:`, que nunca faltam quando `--resolve` rodou.

## Contribuindo

Issues e PRs são bem-vindos. Leia [CONTRIBUTING.md](./CONTRIBUTING.md) antes.

## Licença

[MIT](./LICENSE)
