from django.contrib import admin
from django.urls import path, include
from django.shortcuts import redirect

def home_r(request):
   return redirect('/chat/')  # Redirect root URL to /chat/

urlpatterns = [
    path('admin/', admin.site.urls),
    path('',include('accounts.urls')),
    path('ch', home_r, name='home_r'),  # Add this line
    path('chat/', include("chat.urls")),
]