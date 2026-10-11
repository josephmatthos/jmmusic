# Desenvolvimento local

## Pré-requisitos

- Node.js 20+
- Docker Desktop
- Git

## Passos

1. Instale as dependências do monorepo:
   npm install

2. Suba banco e cache:
   docker compose -f infra/docker-compose.yml up -d

3. Configure as variáveis de ambiente:
   - copie `apps/api/.env.example` para `apps/api/.env`
   - copie `apps/web/.env.local.example` para `apps/web/.env.local`
   - ajuste chaves e URLs para o seu ambiente local

4. Rode as migrations do Prisma:
   cd apps/api
   npx prisma migrate dev

5. Popule o banco:
   npm run seed

6. Suba a API:
   npm run dev

7. Suba a web:
   cd apps/web
   npm run dev

A API ficará em http://localhost:3000
A web ficará em http://localhost:3001

## Observação sobre VS Code Web

VS Code Web (github.dev / vscode.dev) não executa terminal.
Para rodar os comandos acima use GitHub Codespaces, Gitpod ou uma máquina local.

## Configuração de storage

Este projeto aceita os nomes de ambiente legados e os novos, para evitar quebrar setups antigos:

- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`
- `B2_ENDPOINT`, `B2_MEDIA_ENDPOINT`, `B2_REGION`, `B2_MEDIA_REGION`, `B2_BUCKET`, `B2_MEDIA_BUCKET`

O driver de storage decide automaticamente qual conjunto usar.
