export const PORT = Number(process.env.PORT ?? 3000);
export const HOST = process.env.HOST ?? "localhost";
export const BASE_URL = `http://${HOST}:${PORT}`;
export const ORPC_BASE_URL = `${BASE_URL}/orpc`;
export const APP_NAME = "graph-tool";
export const APP_VERSION = "0.1.0";
export const TURSO_URL = process.env.TURSO_URL;
export const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN ?? "";
