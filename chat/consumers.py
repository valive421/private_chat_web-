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

from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.contrib.auth import get_user_model
from django.core.exceptions import ObjectDoesNotExist

User = get_user_model()

class VideoCallConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.user = self.scope["user"]
        if not self.user.is_authenticated:
            await self.close()
            return

        self.video_chat_room = f"video_chatroom_{self.user.username}"
        await self.channel_layer.group_add(
            self.video_chat_room,
            self.channel_name
        )
        await self.accept()
        await self.send(text_data=json.dumps({
            "action": "connection_success",
            "message": "WebSocket connection established",
            "username": self.user.username
        }))

    async def disconnect(self, close_code):
        if hasattr(self, 'video_chat_room'):
            await self.channel_layer.group_discard(
                self.video_chat_room,
                self.channel_name
            )

    async def receive(self, text_data):
        try:
            data = json.loads(text_data)
            action = data.get('action')
            
            if action == 'ping':
                await self.send(text_data=json.dumps({'action': 'pong'}))
                return
                
            if not action:
                await self.send(text_data=json.dumps({
                    "action": "error",
                    "message": "Missing action field"
                }))
                return

            recipient_username = data.get('recipient')
            if not recipient_username:
                await self.send(text_data=json.dumps({
                    "action": "error",
                    "message": "Missing recipient field"
                }))
                return

            # Validate recipient exists
            recipient = await self.get_user(recipient_username)
            if not recipient:
                await self.send(text_data=json.dumps({
                    "action": "error",
                    "message": "Recipient not found"
                }))
                return

            # Handle different actions
            if action == 'call':
                await self.handle_call(recipient_username)
            elif action in ['offer', 'answer', 'candidate']:
                if not data.get(action):  # Check offer/answer/candidate exists
                    await self.send(text_data=json.dumps({
                        "action": "error",
                        "message": f"Missing {action} field"
                    }))
                    return
                await self.forward_signal(data, recipient_username)
            elif action in ['accept', 'decline', 'end-call']:
                await self.forward_signal(data, recipient_username)
            else:
                await self.send(text_data=json.dumps({
                    "action": "error",
                    "message": "Invalid action"
                }))

        except json.JSONDecodeError:
            await self.send(text_data=json.dumps({
                "action": "error",
                "message": "Invalid JSON format"
            }))
        except Exception as e:
            await self.send(text_data=json.dumps({
                "action": "error",
                "message": str(e)
            }))

    async def handle_call(self, recipient_username):
        """Handle call initiation"""
        await self.channel_layer.group_send(
            f"video_chatroom_{recipient_username}",
            {
                "type": "signal",
                "action": "call",
                "caller": self.user.username,
                "recipient": recipient_username,
                "timestamp": self.get_timestamp()
            }
        )

    async def forward_signal(self, data, recipient_username):
        """Forward signaling data to recipient"""
        data_to_send = {
            **data,
            "sender": self.user.username,
            "timestamp": self.get_timestamp()
        }
        await self.channel_layer.group_send(
            f"video_chatroom_{recipient_username}",
            {
                "type": "signal",
                **data_to_send
            }
        )

    async def signal(self, event):
        """Send signaling data to client"""
        await self.send(text_data=json.dumps({
            k: v for k, v in event.items() 
            if k not in ['type']
        }))

    @database_sync_to_async
    def get_user(self, username):
        try:
            return User.objects.get(username=username)
        except ObjectDoesNotExist:
            return None
            
    def get_timestamp(self):
        from datetime import datetime
        return datetime.now().isoformat()
