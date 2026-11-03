export const html = (body: string) => `<!doctype html>
<html>
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Personal Assistant</title>
  <style>
    body{font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; padding: 24px; line-height:1.5}
    h1{margin-top:0}
    code, pre{background:#f6f8fa; padding:2px 6px; border-radius:6px}
    ul{margin:0; padding-left:18px}
    a{color:#2563eb; text-decoration:none}
    a:hover{text-decoration:underline}
  </style>
  </head>
  <body>${body}</body>
</html>`;
