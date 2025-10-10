module.exports = {
  apps: [
    {
      name: "memory-worker",
      cwd: "packages/server",
      script: "bun",
      args: ["run", "dev"],
      interpreter: "none",
  env_file: "packages/server/.dev.vars",
      max_restarts: 5,
      restart_delay: 2000,
      error_file: "logs/memory-worker-error.log",
      out_file: "logs/memory-worker.log",
      merge_logs: true,
      autorestart: true
    }
  ]
};
