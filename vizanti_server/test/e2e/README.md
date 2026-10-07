# Browser tests

Playwright tests of the web UI. They need a running Vizanti server with rosbridge:

```bash
# terminal 1 (a sourced ROS 2 workspace with vizanti built)
ros2 launch vizanti_server vizanti_server.launch.py

# terminal 2
cd vizanti_server/test/e2e
npm ci
npx playwright install chromium       # once
npx playwright test                   # VIZANTI_URL=http://robot:5000 to test another server
```

Each test starts with an empty browser profile, so it sees the server's default layout; nothing
is saved on the server. Failures leave a trace and screenshot in `test-results/`
(`npx playwright show-trace test-results/.../trace.zip`). CI runs them in a ROS container
(`.github/workflows/ci.yml`, job `browser`).
