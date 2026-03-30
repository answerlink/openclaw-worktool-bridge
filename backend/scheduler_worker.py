import asyncio
import logging
import os

import main

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger('scheduler_worker')

POLL_SECONDS = float(os.getenv('SCHEDULER_POLL_SECONDS', '2'))
BATCH_LIMIT = int(os.getenv('SCHEDULER_BATCH_LIMIT', '20'))


async def _run_loop() -> None:
    main.init_db()
    logger.info('scheduler worker started poll=%s batch_limit=%s', POLL_SECONDS, BATCH_LIMIT)
    while True:
        try:
            res = await main.run_scheduled_tasks_tick(limit=BATCH_LIMIT)
            picked = int(res.get('picked') or 0)
            done = int(res.get('done') or 0)
            if picked > 0:
                logger.info('scheduler tick picked=%s done=%s', picked, done)
        except Exception as e:
            logger.exception('scheduler tick failed err=%s', str(e))
        await asyncio.sleep(POLL_SECONDS)


if __name__ == '__main__':
    asyncio.run(_run_loop())
