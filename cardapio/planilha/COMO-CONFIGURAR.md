# Painel do cardápio: como configurar (uma vez por cliente)

O painel (`admin.html`) salva os dados numa **planilha do Google da cliente**.
O cardápio (`index.html` ou `elementor.html`) lê essa planilha. Tudo é gratuito.

## 1. Criar a planilha e o "servidor" (5 minutos)

1. Entre com a **conta Google da cliente** e crie uma planilha em <https://sheets.new>.
   Dê um nome, por exemplo "Cardápio – Studio Ana".
2. Abra o menu **Extensões → Apps Script**.
3. Apague o que estiver no editor, cole todo o conteúdo de `planilha/Codigo.gs` e clique em 💾 **Salvar**.
4. No topo, escolha a função **configurar** e clique em **▶ Executar**.
   O Google pede autorização: clique em *Revisar permissões* → escolha a conta.
   Na tela de aviso, clique em *Avançado* → *Acessar (não seguro)* → *Permitir*.
   (O aviso aparece porque o script é seu, e não de uma empresa verificada.)
5. Volte à planilha: apareceu a aba **Config**. Troque a senha na célula **B1**.
   Enquanto a senha for `troque-esta-senha`, o painel não deixa entrar.
6. No Apps Script, clique em **Implantar → Nova implantação**:
   - Tipo: **App da Web** (ícone de engrenagem ⚙)
   - Executar como: **Eu**
   - Quem pode acessar: **Qualquer pessoa**
   - Clique em **Implantar** e copie o link que termina em **`/exec`**.

## 2. Ligar o cardápio à planilha

Abra `index.html` (e `elementor.html`, se usar Elementor), procure a linha

```js
const DATA_URL = '';
```

e cole o link entre as aspas:

```js
const DATA_URL = 'https://script.google.com/macros/s/AKfy.../exec';
```

Publique o site de novo (GitHub, Netlify ou o widget do Elementor). Isso só é feito **uma vez**.

## 3. Usar o painel

Abra `admin.html` no mesmo endereço do cardápio (ex.: `seusite.com/cardapio/admin.html`).
Cole o link `/exec` e a senha. No celular, dá para adicionar o painel à tela inicial.

| Aba | O que dá para fazer |
|---|---|
| 🏪 Loja | Nome, frase da capa, WhatsApp, Pix, Instagram, endereço, atendimento a domicílio, formas de pagamento e horários |
| 💅 Serviços | Criar, editar, duplicar, ocultar e reordenar serviços e categorias. Fotos, preço antigo riscado, selos e opções com preço |
| 🎁 Promoções | Banners do topo e cupons de desconto |
| 🎨 Aparência | Paletas prontas, cores e logo |
| 🚀 Publicar | Linha do `DATA_URL`, QR Code do cardápio, cópias de segurança e "voltar para a versão anterior" |

- A **prévia ao vivo** mostra as mudanças na hora. As clientes só veem depois de clicar em **Salvar**.
- As **fotos** vão para a pasta "Cardápio – Fotos" no Google Drive da conta. Elas são reduzidas automaticamente antes do envio.
- A aba **Serviços (consulta)** da planilha mostra a lista de serviços e preços só para consulta. Editar ali não muda o site: use o painel.
- A aba **Histórico** registra cada gravação. A aba **Backup** guarda a versão anterior, que dá para restaurar pelo painel.

## 4. Pagamentos on-line

### Pix com QR Code (sem taxa)
No painel, aba **Loja → Pix**, preencha:
- a chave e o tipo dela;
- o nome de quem recebe (igual ao do banco);
- a cidade da loja.

Na finalização, a cliente vê um QR Code e o código **copia e cola já com o valor do pedido**. O dinheiro cai direto na conta.
A loja confere o pagamento pelo app do banco. O pedido chega no WhatsApp com o número (ex.: `🧾 Pedido P1A2B3C`), e esse mesmo número aparece na descrição do Pix.

### Cartão on-line pelo Mercado Pago (cartão, Pix e boleto)
1. Entre em <https://www.mercadopago.com.br/developers/panel/app> com a conta da loja.
   Clique em **Criar aplicação** e escolha *Pagamentos on-line → Checkout Pro*.
2. Em **Credenciais de produção**, copie o **Access Token** (começa com `APP_USR-`).
3. Cole o token na planilha, aba **Config**, célula **B2**.
   ⚠️ O token dá acesso à conta: não compartilhe a planilha e **nunca** cole o token no painel ou no site.
4. No painel, aba **Loja**, marque **Ativar pagamento on-line pelo Mercado Pago** e clique em **Salvar**.

Como funciona:
- A cliente toca em **Pagar e enviar pedido**.
- O pedido vai para o WhatsApp da loja, já com o link de pagamento, e a cliente é levada ao Mercado Pago.
- **O valor é calculado pela planilha** com os preços salvos. Ninguém consegue mudar o valor pelo navegador.
- A aba **Pagamentos** da planilha mostra cada pedido: *aguardando pagamento* → *aprovado*, *recusado* etc. O Mercado Pago avisa a planilha sozinho.
- Quando o pagamento é aprovado, a cliente volta ao cardápio e vê "Pagamento aprovado".

> **Já tinha a planilha configurada antes?** Cole o `Codigo.gs` novo no Apps Script e rode **configurar** de novo.
> O Google vai pedir uma autorização nova, para "conectar a serviço externo" (o Mercado Pago).
> Depois faça **Implantar → Gerenciar implantações → ✏️ → Nova versão → Implantar**. O link `/exec` continua o mesmo.

## Problemas comuns

- **"Senha incorreta":** confira a célula B1 da aba Config (sem espaços sobrando).
- **"Pagamento on-line indisponível":** confira o token na célula B2, se a opção está ativada no painel (e salva) e se o `DATA_URL` está no site.
- **"Resposta inesperada":** o link precisa terminar em `/exec`, e o acesso tem que ser "Qualquer pessoa".
- **Alterei o `Codigo.gs` e nada mudou:** em **Implantar → Gerenciar implantações → ✏️ editar**, escolha *Nova versão* e implante de novo. O link continua o mesmo.
- **Trocar a senha:** basta mudar a célula B1. Quem estiver logado precisa entrar de novo.

## Sem planilha (só para testar)

Na tela de entrada, use "Testar sem planilha". Os dados ficam só naquele navegador.
Na aba Publicar, dá para baixar um `dados.json`: coloque o arquivo ao lado do `index.html` e use `const DATA_URL = 'dados.json';`.
