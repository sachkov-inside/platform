"use client";

const nestOrigin = "http://127.0.0.1:3001";

export const absoluteBrowserRequest = () => fetch(`${nestOrigin}/health`);
