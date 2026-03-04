export default function Home() {
  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui" }}>
      <h1>Gorgias Webhook</h1>
      <p>POST to <code>/api/webhooks/gorgias</code> to receive Gorgias events.</p>
    </main>
  );
}
