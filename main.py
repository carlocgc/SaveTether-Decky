# SaveTether's Decky backend. It only runs the installed `savetether` CLI with --json and passes the
# result through (design 5.11); the calls come in phase 4 task T4.
import decky


class Plugin:
    async def _main(self):
        decky.logger.info("SaveTether plugin loaded")

    async def _unload(self):
        decky.logger.info("SaveTether plugin unloaded")
