# 🎮 GameList — Catálogo de Jogos Zerados

Catálogo visual dos jogos que você já zerou, com capas, separado por console.
**A lista fica salva no próprio repositório** (`games.json`) — cada alteração vira um commit automático.

## Arquivos

| Arquivo | O que é |
|---|---|
| `index.html` | Estrutura da página |
| `styles.css` | Visual |
| `app.js` | Lógica (busca, capas, popup, sincronização) |
| `games.json` | **Sua lista de jogos** — o "banco de dados" do catálogo |
| `games-data.js` | Cópia da lista usada só como fallback offline |

## Passo a passo completo

### 1. Publicar no GitHub Pages
1. Crie um repositório novo no GitHub (ex: `gamelist`)
2. Suba todos os arquivos na raiz
3. **Settings → Pages → Source: Deploy from a branch → main / (root) → Save**
4. Em ~1 minuto: `https://SEU-USUARIO.github.io/gamelist/`

### 2. Criar o token de acesso (pra salvar automático)
1. GitHub → foto de perfil → **Settings**
2. **Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**
3. Configure:
   - **Repository access:** Only select repositories → escolha o repositório `gamelist`
   - **Permissions:** Contents → **Read and write**
   - **Expiration:** o prazo que preferir (dá pra renovar depois)
4. Copie o token gerado (`github_pat_...`)

### 3. Conectar o catálogo
1. Abra seu catálogo publicado
2. Clique em **⚙ GitHub**
3. Preencha repositório (`usuario/gamelist`), branch (`main`) e cole o token
4. **Testar e Salvar**

Pronto: toda adição/remoção de jogo vira um commit no `games.json`.
Pra usar em outro dispositivo (celular, outro PC), é só abrir o site e configurar o ⚙ GitHub lá também — ele carrega a mesma lista.

## ⚠️ Segurança do token
- O token fica salvo **somente no navegador** (localStorage). Nunca é enviado pra lugar nenhum além da API do GitHub.
- **Nunca** cole o token em arquivos do repositório.
- Se o repositório for público, o `games.json` (sua lista) é visível — o token não.

## Funcionalidades
- ✅ Lista salva no repositório via commits automáticos (sincroniza entre dispositivos)
- ✅ Catálogo com capas (Wikipedia, automático)
- ✅ Abas por console
- ✅ Popup de detalhes: ano de lançamento, plataformas, resumo da história
- ✅ Busca pelo nome oficial ao adicionar
- ✅ Backup/restauração manual em `.json` (camada extra de segurança)
- ✅ Funciona offline com a cópia local; sincroniza quando voltar

## APIs usadas
- **GitHub API** — leitura/gravação do `games.json` (precisa do token)
- **Wikipedia API** — busca de jogos, capas e resumos (gratuita, sem chave)
