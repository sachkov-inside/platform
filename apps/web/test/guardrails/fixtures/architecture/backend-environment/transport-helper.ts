const baseUrl = process.env.NEXT_PUBLIC_NEST_URL;

export const directBrowserRequest = () => fetch(`${baseUrl}/health`);
