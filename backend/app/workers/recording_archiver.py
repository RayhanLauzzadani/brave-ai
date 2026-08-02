import asyncio
import logging

from app.services.recording_archiver import run_recording_archiver


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    asyncio.run(run_recording_archiver())


if __name__ == "__main__":
    main()
