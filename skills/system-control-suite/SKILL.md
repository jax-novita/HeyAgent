---
name: system-control-suite
description: Full PC control via system.control — volume, display, power, network, hygiene
tools:
  - system.control
  - system.controls_help
---

# Full PC control

For **any** OS request use `system_control` with `action=…`.

Do not say «не могу» if an action exists. If unknown → `system_controls_help`, then pick the closest action. Last resort: `shell_exec_elevated`.

Examples:
- яркость −10% → `brightness_delta` delta=-10
- громкость 40 → `volume_set` level=40
- 144 Гц → `refresh_rate` hz=144
- хотспот → `hotspot_on`
- очисти корзину → `recycle_empty`
- заблокируй → `lock`
