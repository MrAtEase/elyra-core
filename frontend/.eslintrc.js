module.exports = {
  extends: ["next/core-web-vitals"],
  rules: {
    // ❌ Relative OAuth-Starts sind verboten
    "no-restricted-syntax": [
      "error",
      {
        selector: "Literal[value=/^\\/assistant\\/oauth/]",
        message:
          "❌ OAuth must start via API_ORIGIN using startGoogleOAuth(). Relative /assistant/oauth/* is forbidden."
      },
      {
        selector:
          "CallExpression[callee.object.name='router'][callee.property.name=/^(push|replace)$/]",
        message:
          "❌ router.push / router.replace must not be used for OAuth. Use startGoogleOAuth()."
      }
    ]
  }
};
