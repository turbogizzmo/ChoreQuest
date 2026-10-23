import asyncio
import json
from collections import defaultdict

from fastapi import WebSocket

# A stalled client must not hold up the HTTP request that triggered the send.
SEND_TIMEOUT_SECONDS = 5


class WebSocketManager:
    def __init__(self):
        self.active_connections: dict[int, set[WebSocket]] = defaultdict(set)

    async def connect(self, websocket: WebSocket, user_id: int):
        await websocket.accept()
        self.active_connections[user_id].add(websocket)

    def disconnect(self, websocket: WebSocket, user_id: int):
        conns = self.active_connections.get(user_id)
        if conns is None:
            return
        conns.discard(websocket)
        if not conns:
            self.active_connections.pop(user_id, None)

    async def _send(self, websocket: WebSocket, user_id: int, data: str):
        try:
            await asyncio.wait_for(websocket.send_text(data), SEND_TIMEOUT_SECONDS)
        except Exception:
            self.disconnect(websocket, user_id)

    async def _fanout(self, user_ids, message: dict):
        data = json.dumps(message)
        # Snapshot the sockets first: connect/disconnect can run while we await.
        sends = [
            self._send(ws, uid, data)
            for uid in user_ids
            for ws in list(self.active_connections.get(uid, ()))
        ]
        if sends:
            await asyncio.gather(*sends)

    async def send_to_user(self, user_id: int, message: dict):
        await self._fanout([user_id], message)

    async def broadcast(self, message: dict, exclude_user: int | None = None):
        await self._fanout(
            [uid for uid in list(self.active_connections) if uid != exclude_user],
            message,
        )

    async def send_to_parents(self, message: dict, parent_ids: list[int]):
        await self._fanout(parent_ids, message)


ws_manager = WebSocketManager()
