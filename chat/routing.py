from django.urls import path
from . import consumers
websocket_urlpatterns=[
    path("chat/chat/",consumers.chat_Consumer.as_asgi()),
    path("chat/video/",consumers.VideoCallConsumer.as_asgi()),
]