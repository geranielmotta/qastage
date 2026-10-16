# @qastage/shell

Host do micro-frontend (MFE) do QAStage — React + TS, Module Federation.

**Status:** placeholder do F0. Será implementado no F1, quando entra o primeiro
remote (`plugin-ui`). O shell cuida de layout, navegação, seleção de ambiente,
auth do próprio sistema e do carregamento dos remotes de cada plugin.

O shell é cliente do runner via API HTTP — ele nunca executa Playwright.
