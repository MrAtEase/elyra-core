export default function PrivacyPage() {
  return (
    <section className="marketing-page">
      <h1>Privacy</h1>

      <h2>Who we are</h2>
      <p>
        Elyra Core is an independent software project created and developed by
        Paul Odak. As the project owner, Paul Odak is the data controller for
        personal data processed through this platform.
      </p>

      <h2>Data handling</h2>
      <p>
        Elyra Core processes workspace data strictly within active workspace
        boundaries and according to configured integrations. We collect only the
        data necessary to provide the service.
      </p>

      <h2>Your rights</h2>
      <p>
        Under the GDPR, you have the right to access, rectify, erase, and
        export your personal data. You may object to or restrict processing and
        withdraw consent at any time.
      </p>

      <h2>Security</h2>
      <p>
        All data is stored on EU-based servers with AES-256 encryption at rest
        and TLS 1.3 in transit. AI processing happens in isolated, ephemeral
        environments with no data retained beyond your active session.
      </p>

      <h2>Cookies</h2>
      <p>
        This application uses only essential cookies for functionality. No
        tracking cookies or third-party analytics are used.
      </p>

      <h2>Contact</h2>
      <p>
        For privacy-related inquiries, contact{" "}
        <a href="mailto:privacy@elyra-core.app">privacy@elyra-core.app</a>.
      </p>
    </section>
  );
}
