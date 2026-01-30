/**
 * OpenAPI Routes
 *
 * Serves the OpenAPI specification and provides interactive documentation.
 */

import { Hono } from "hono";
import { stringify as yamlStringify } from "yaml";
import { generateOpenAPISpec } from "../api/generate-openapi";

const openapi = new Hono();

/**
 * GET /openapi.json
 *
 * Returns the OpenAPI 3.1 specification as JSON.
 */
openapi.get("/openapi.json", (c) => {
  const spec = generateOpenAPISpec();
  return c.json(spec);
});

/**
 * GET /openapi.yaml
 *
 * Returns the OpenAPI 3.1 specification as YAML.
 */
openapi.get("/openapi.yaml", (c) => {
  const spec = generateOpenAPISpec();
  c.header("Content-Type", "text/yaml; charset=utf-8");
  return c.text(yamlStringify(spec));
});

/**
 * GET /docs
 *
 * Serves a Swagger UI page for interactive API documentation.
 */
openapi.get("/docs", (c) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Flywheel Gateway API Documentation</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui.css" />
  <style>
    body { margin: 0; }
    .swagger-ui .topbar { display: none; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-bundle.js"></script>
  <script>
    window.onload = () => {
      window.ui = SwaggerUIBundle({
        url: '/openapi.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIBundle.SwaggerUIStandalonePreset
        ],
        layout: "BaseLayout",
        validatorUrl: null,
        tryItOutEnabled: true,
      });
    };
  </script>
</body>
</html>`;

  return c.html(html);
});

/**
 * GET /redoc
 *
 * Serves a ReDoc page for alternative API documentation.
 */
openapi.get("/redoc", (c) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Flywheel Gateway API Documentation</title>
  <link href="https://fonts.googleapis.com/css?family=Montserrat:300,400,700|Roboto:300,400,700" rel="stylesheet">
  <style>
    body { margin: 0; padding: 0; }
  </style>
</head>
<body>
  <redoc spec-url='/openapi.json'></redoc>
  <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>
</body>
</html>`;

  return c.html(html);
});

export default openapi;
