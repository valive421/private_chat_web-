import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.contrib.auth import get_user_model
from chat.models import Threads, ChatMessage

User = get_user_model()

class chat_Consumer(AsyncWebsocketConsumer):
    async def connect(self):
        """Handles new WebSocket connections."""
        user = self.scope["user"]

        if user.is_authenticated:
            chat_room = f"user_chatroom_{user.username}"
            self.chat_room = chat_room
            await self.channel_layer.group_add(chat_room, self.channel_name)
            await self.accept()
        else:
            await self.close()

    async def receive(self, text_data):
        """Handles incoming messages."""
        try:
            rec_data = json.loads(text_data)
            msg = rec_data.get("message")
            sent_by_username = rec_data.get("sent_by")
            sent_to_username = rec_data.get("send_to")

            if not msg or not sent_by_username or not sent_to_username:
                return

            sent_by_user = await self.get_user_object(sent_by_username)
            sent_to_user = await self.get_user_object(sent_to_username)

            if not sent_by_user or not sent_to_user:
                return

            # Fetch or create a thread
            thread = await self.get_or_create_thread(sent_by_user, sent_to_user)

            # Save message
            await self.save_message(thread, sent_by_user, msg)

            # Send message to other user's chatroom
            other_chat_room = f"user_chatroom_{sent_to_username}"
            response = {
                "message": msg,
                "sent_by": sent_by_user.username,
            }

            await self.channel_layer.group_send(
                other_chat_room,
                {
                    "type": "chat_message",
                    "message": json.dumps(response)
                }
            )

        except json.JSONDecodeError:
            print("Invalid JSON format received")

    async def chat_message(self, event):
        """Handles sending messages to the WebSocket client."""
        message = event.get("message")
        if message:
            await self.send(text_data=message)

    async def disconnect(self, close_code):
        """Handles WebSocket disconnection."""
        if hasattr(self, "chat_room"):
            await self.channel_layer.group_discard(self.chat_room, self.channel_name)

    @database_sync_to_async
    def get_user_object(self, username):
        """Fetches the user object using the username."""
        return User.objects.filter(username=username).first()

    @database_sync_to_async
    def get_or_create_thread(self, user1, user2):
        """Fetch or create a thread between two users."""
        thread, created = Threads.objects.get_or_create(
            first_person=min(user1, user2, key=lambda u: u.id),
            second_person=max(user1, user2, key=lambda u: u.id),
        )
        return thread

    @database_sync_to_async
    def save_message(self, thread, user, message):
        """Save a new chat message in the database."""
        return ChatMessage.objects.create(thread=thread, user=user, message=message)

class VideoCallConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.user = self.scope["user"]
        self.video_chat_room = f"video_chatroom_{self.user.username}"

        await self.channel_layer.group_add(self.video_chat_room, self.channel_name)
        await self.accept()
    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.video_chat_room, self.channel_name)

    async def receive(self, text_data):
        data = json.loads(text_data)
        action = data.get("action")
        recipient = data.get("recipient")  # Username of the receiver

        if action in ["message", "call", "accept", "decline", "offer", "answer", "candidate"]:
            await self.channel_layer.group_send(
    f"video_chatroom_{recipient}",  # Use video group
    {**data, "type": "signal"},
)


    async def signal(self, event):
        await self.send(json.dumps(event))
