const proxyConfigByPath = {
  '/api-local/': {
    context: ['/api-local/'],
    target: process.env.API_LOCAL_PATH,
    pathRewrite: { '^/api-local/': '/api/v1' },
    changeOrigin: true,
    secure: false,
  },
};

export default proxyConfigByPath;
