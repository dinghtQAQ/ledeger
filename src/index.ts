import { Hono } from "hono";

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => c.text("Hello World!"));

app.get("/health", (c) => c.json({ status: "ok" }));

app.get("/health/db", async (c) => {
	try {
		const result = await c.env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
		return c.json({ status: result?.ok === 1 ? "ok" : "degraded" });
	} catch (error) {
		console.error("D1 health check failed", error);
		return c.json({ status: "error" }, 503);
	}
});

export default app satisfies ExportedHandler<Env>;
