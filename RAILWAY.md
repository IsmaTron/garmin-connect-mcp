# Desplegar en Railway

Guía paso a paso para desplegar este servidor MCP de Garmin Connect en [Railway](https://railway.com) y conectarlo a Claude (u otro cliente MCP) por HTTP.

## Qué incluye la adaptación

- **Transporte Streamable HTTP**: con `MCP_TRANSPORT=http` el servidor escucha en un puerto y expone el protocolo MCP en `POST /mcp` (el modo `stdio` para uso local sigue siendo el predeterminado).
- **Endpoint `/health`**: usado por el healthcheck de Railway.
- **Autenticación del endpoint**: si defines `MCP_AUTH_TOKEN`, toda petición a `/mcp` debe llevar la cabecera `Authorization: Bearer <token>`.
- **`Dockerfile` + `railway.json`**: build reproducible; el Dockerfile ya establece `MCP_TRANSPORT=http`.
- **Tokens por variables de entorno**: `GARMIN_OAUTH1_TOKEN` / `GARMIN_OAUTH2_TOKEN` permiten sembrar los tokens OAuth generados en tu máquina (imprescindible si tu cuenta tiene MFA).
- **`GARMIN_TOKEN_DIR`**: directorio de tokens configurable para persistirlos en un volumen de Railway.

## Paso 1 — Crear el proyecto en Railway

1. Entra en [railway.com](https://railway.com) e inicia sesión.
2. Pulsa **New Project** → **Deploy from GitHub repo**.
3. Autoriza tu cuenta de GitHub si es la primera vez y selecciona el repositorio `garmin-connect-mcp`.
4. Railway detectará el `Dockerfile` y el `railway.json` automáticamente. No cambies el build.

## Paso 2 — Configurar las variables de entorno

En tu servicio: pestaña **Variables** → **New Variable** (o usa **Raw Editor** para pegar varias de golpe). Añade estas variables una a una:

### Obligatorias

| Variable | Valor | Descripción |
|----------|-------|-------------|
| `GARMIN_EMAIL` | `tu-email@ejemplo.com` | Email de tu cuenta Garmin Connect |
| `GARMIN_PASSWORD` | `tu-password` | Contraseña de tu cuenta Garmin Connect |

### Muy recomendada (seguridad)

| Variable | Valor | Descripción |
|----------|-------|-------------|
| `MCP_AUTH_TOKEN` | cadena aleatoria larga | Protege `/mcp` con Bearer token. Genera una con `openssl rand -hex 32`. Sin ella, cualquiera con la URL accede a tus datos de Garmin |

### Solo si tu cuenta tiene MFA (verificación en dos pasos)

En Railway no hay terminal interactivo para introducir el código MFA, así que genera los tokens en tu máquina y pégalos como variables:

1. En tu ordenador ejecuta:
   ```bash
   GARMIN_EMAIL='tu-email@ejemplo.com' GARMIN_PASSWORD='tu-password' npx -y @nicolasvegam/garmin-connect-mcp setup
   ```
2. Introduce el código MFA cuando lo pida. Los tokens se guardan en `~/.garmin-mcp/`.
3. Copia el contenido de cada fichero en su variable:

| Variable | Valor |
|----------|-------|
| `GARMIN_OAUTH1_TOKEN` | Contenido completo de `~/.garmin-mcp/oauth1_token.json` |
| `GARMIN_OAUTH2_TOKEN` | Contenido completo de `~/.garmin-mcp/oauth2_token.json` |

El token OAuth1 dura aproximadamente un año; el OAuth2 se renueva solo a partir del OAuth1.

### Opcionales

| Variable | Valor | Descripción |
|----------|-------|-------------|
| `GARMIN_TOKEN_DIR` | `/data/garmin-mcp` | Directorio donde persistir los tokens. Úsala junto a un volumen (Paso 4) |
| `GARMIN_MFA_CODE` | código de 6 dígitos | Alternativa rápida a los tokens sembrados: código MFA de un solo uso para el primer arranque. Caduca en minutos, así que redepliega justo después de ponerla |
| `MCP_TRANSPORT` | `http` | Ya viene definida en el Dockerfile; solo tendrías que tocarla para forzar `stdio` |
| `PORT` | — | **No la definas**: Railway la inyecta automáticamente |

Tras guardar las variables, Railway redespliega el servicio automáticamente.

## Paso 3 — Generar el dominio público

1. En el servicio: **Settings** → **Networking** → **Generate Domain**.
2. Cuando pregunte el puerto, indica el que expone el contenedor (Railway suele detectarlo; si no, usa `3000` o deja que use la variable `PORT`).
3. Obtendrás una URL tipo `https://garmin-connect-mcp-production.up.railway.app`.
4. Comprueba que responde:
   ```bash
   curl https://TU-DOMINIO.up.railway.app/health
   ```
   Debe devolver `{"status":"ok","server":"garmin-connect-mcp"}`.

## Paso 4 (opcional) — Volumen para persistir tokens

Sin volumen, los tokens renovados se pierden en cada redeploy y el servidor vuelve a autenticarse con email/password (o con los tokens sembrados). Para evitarlo:

1. Click derecho sobre el servicio → **Attach Volume** (o **Settings** → **Volumes**).
2. Mount path: `/data`.
3. Añade la variable `GARMIN_TOKEN_DIR` = `/data/garmin-mcp`.
4. Redespliega.

## Paso 5 — Conectar desde Claude

### Claude Code

```bash
claude mcp add --transport http garmin https://TU-DOMINIO.up.railway.app/mcp --header "Authorization: Bearer TU_MCP_AUTH_TOKEN"
```

### Claude.ai (conector remoto, planes de pago)

1. **Settings** → **Connectors** → **Add custom connector**.
2. URL: `https://TU-DOMINIO.up.railway.app/mcp`.
3. Si tu cliente permite cabeceras personalizadas, añade `Authorization: Bearer TU_MCP_AUTH_TOKEN`. Si no las permite, deja `MCP_AUTH_TOKEN` sin definir en Railway (menos seguro: la URL pasa a ser el único secreto).

### Cualquier cliente MCP con Streamable HTTP

- URL: `https://TU-DOMINIO.up.railway.app/mcp`
- Cabecera: `Authorization: Bearer TU_MCP_AUTH_TOKEN`

## Solución de problemas

| Síntoma | Causa probable | Solución |
|---------|----------------|----------|
| El deploy falla en healthcheck | El servidor no arrancó | Mira **Deploy Logs**: si falta `GARMIN_EMAIL`/`GARMIN_PASSWORD` el proceso sale con error al arrancar |
| `401 Unauthorized` al llamar a `/mcp` | Falta o no coincide el Bearer token | Revisa que la cabecera `Authorization: Bearer ...` coincida exactamente con `MCP_AUTH_TOKEN` |
| Error `MFA is required but no MFA handler is available` en los logs | Cuenta con MFA sin tokens sembrados | Sigue la sección de MFA del Paso 2 |
| Las herramientas fallan tras semanas funcionando | Tokens caducados | Vuelve a ejecutar el setup local y actualiza `GARMIN_OAUTH1_TOKEN`/`GARMIN_OAUTH2_TOKEN`, o añade un volumen (Paso 4) |
| Quiero rotar el token del endpoint | — | Cambia `MCP_AUTH_TOKEN` en Railway y actualiza la cabecera en tus clientes |

## Verificación rápida del protocolo

```bash
curl -X POST https://TU-DOMINIO.up.railway.app/mcp \
  -H "Authorization: Bearer TU_MCP_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl","version":"1.0"}}}'
```

Debe responder con `serverInfo.name = garmin-connect-mcp` y la lista de capacidades.
