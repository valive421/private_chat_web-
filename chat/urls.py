from django.urls import path
from .views import chat_page

urlpatterns = [
    path("", chat_page, name="chat_page"),  # Main chat page
    path("<str:username>/", chat_page, name="chat_with_user"),  # Chat with a specific user
]
