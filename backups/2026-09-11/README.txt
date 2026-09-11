Backup Escala DML — 2026-09-11
================================

Conteúdo deste backup (branch backup/2026-09-11):

1) backups/2026-09-11/firestore/*.json
   Dump bruto (REST API, formato Firestore) das coleções PÚBLICAS do
   projeto Firebase "escala-dml" no momento do backup:
     riders.json          — grupos, PINs, dias/horário de ensaio
     estudio.json         — checklists de ensaio preenchidos
     solicitacoes.json    — solicitações de equipamento (vazia no momento)
     agendaExterna.json   — agenda externa dos grupos (vazia no momento)

   NÃO incluído aqui: coleção "pushTokens" (tokens de notificação push —
   não publicado neste repositório público por privacidade; incluído
   apenas no pacote de backup local entregue ao usuário) e as coleções
   "usuarios"/"convites", que exigem login autenticado (Firebase Auth) e
   não são acessíveis via API key anônima. Para backup completo dessas,
   seria necessário exportar pelo Firebase Console (Firestore → Exportar)
   ou via gcloud com uma service account, gravando direto no Google Cloud
   Storage.

2) backups/2026-09-11/config-snapshot/
   Cópia solta dos arquivos de configuração publicados nesse mesmo
   momento: rider-config.json, aviso.json, checklist-config.json, e da
   regra de segurança do Firestore: firestore.rules.
   (nota: instrumentos-config.json ainda não existia no repo público
   neste momento — só é criado na primeira vez que o editor salvar a
   lista de instrumentos na aba Solicitações.)

Este ponto também está marcado com a branch backup/2026-09-11 (e o
repositório escala-dml-public tem sua própria branch backup/2026-09-11,
sem esse dump, apenas o snapshot do código/site publicado naquele
momento). O código completo (com todo o histórico) dos dois
repositórios já vive permanentemente no GitHub em main; este backup é
um ponto de restauração adicional, fixo nesta data, e não deve ser
mesclado (merge) em main.
