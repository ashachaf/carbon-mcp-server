module.exports = {
  apps: [{
    name: "carbon-mcp-server",
    script: "node_modules/.bin/ts-node",
    args: "src/index.ts",
    env_file: ".env",
    watch: false,
  }]
};
