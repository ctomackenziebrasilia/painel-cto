# painel-cto

Painel semanal do Calendário Olímpico do CTO (Centro de Treinamento Olímpico — Colégio Presbiteriano Mackenzie Brasília).

**Acesso:** https://ctomackenziebrasilia.github.io/painel-cto/ (pede a senha de entrada da equipe).

## O que é
Mostra, de forma visual, o resultado da tarefa semanal do Claude ("Calendário Olímpico: editais e olimpíadas novas"):
- olimpíadas novas (aba **Radar** da planilha), com botões para a equipe decidir: Cadastrar, Em análise ou Descartar;
- calendário dos próximos meses;
- datas oficiais encontradas nos editais, com botão para aplicar na aba **Eventos**;
- lista do que precisa ser verificado à mão.

## Arquivos
| Arquivo | Para quê |
|---|---|
| `index.html` | A página (visual). |
| `app.js` | O funcionamento da página. A constante `WEBAPP` guarda o endereço do Apps Script. |
| `dados.json` | Relatório da semana. **Atualizado toda segunda pela tarefa do Claude.** |
| `scripts/Painel.gs` | Código do Apps Script (fica no projeto de script da planilha pública, conta do CTO). |

## Senhas
- **Senha de entrada:** só para ver o painel. É uma "porta": este repositório é público e o conteúdo (datas e nomes de olimpíadas, que já são públicos) pode ser lido aqui.
- **Senha de gravação:** obrigatória para mudar a planilha. É conferida pelo Apps Script, nunca fica no site.
- As duas são definidas na planilha: menu **Calendário CTO → Definir senhas do painel**. Depois de 8 senhas erradas, novas tentativas ficam bloqueadas por 15 minutos.
- Cada gravação fica anotada na aba **Registro do painel**.

## Regras
- Repositório público: nunca enviar dados de alunos nem senhas.
- Datas só de fontes oficiais. Nada é gravado na planilha sem a senha de gravação.
- Lê a planilha pela consulta pública do Google (gviz); colunas localizadas pelo título da linha 1.
