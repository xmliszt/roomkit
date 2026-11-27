const parent = process.ppid;
setInterval(() => {
  if (process.ppid !== parent) process.kill(process.pid, "SIGTERM");
}, 1000).unref();
