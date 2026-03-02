from django.shortcuts import render, redirect
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.models import User
from django.http import JsonResponse
from django.urls import reverse
from django.views.decorators.http import require_http_methods
from django.views.decorators.csrf import csrf_exempt
from django.contrib.auth.decorators import login_required
from django.contrib import messages
import json


def has_system_admin():
    """Check if a System Admin (superuser) already exists."""
    return User.objects.filter(is_superuser=True).exists()


def login_view(request):
    """Render the login page."""
    return render(request, 'auth/login.html')


def onetime_view(request):
    """Render the one-time system admin registration page."""
    # Block access if System Admin already exists
    if has_system_admin():
        return redirect('auth:login')
    
    return render(request, 'auth/onetime.html')


@csrf_exempt
@require_http_methods(["POST"])
def login_api(request):
    """Handle login API request."""
    try:
        data = json.loads(request.body)
        email = data.get('email')
        password = data.get('password')
        
        if not email or not password:
            return JsonResponse({
                'success': False,
                'message': 'Email and password are required',
                'notification': {'message': 'Email and password are required', 'type': 'error'}
            }, status=400)
        
        # First check if user exists and is inactive (before authentication)
        try:
            user_check = User.objects.get(username=email)
            if not user_check.is_active:
                # Verify password before showing inactive message (for security)
                if user_check.check_password(password):
                    return JsonResponse({
                        'success': False,
                        'message': 'Account Inactive: Your account has been deactivated. Please contact the administrator to reactivate your account.',
                        'notification': {'message': 'Account Inactive: Your account has been deactivated. Please contact the administrator to reactivate your account.', 'type': 'error'}
                    }, status=403)
        except User.DoesNotExist:
            pass  # User doesn't exist, will be caught by authenticate below
        
        # Authenticate user (only returns active users by default)
        user = authenticate(request, username=email, password=password)
        
        if user is not None:
            login(request, user)

            # Capture basic session metadata for security/session management.
            from django.utils import timezone

            request.session["client_ip"] = (
                request.META.get("HTTP_X_FORWARDED_FOR", "").split(",")[0].strip()
                or request.META.get("REMOTE_ADDR", "")
            )
            request.session["user_agent"] = request.META.get("HTTP_USER_AGENT", "")[
                :512
            ]
            now_iso = timezone.now().isoformat()
            request.session.setdefault("session_created_at", now_iso)
            request.session["last_seen_at"] = now_iso
            # Check if user needs to set up password (first-time login)
            if hasattr(user, 'profile') and user.profile.role and not user.profile.password_setup_completed:
                # Redirect to password setup page
                if user.profile.role == 'manager':
                    redirect_url = reverse('auth:password_setup') + '?role=manager'
                elif user.profile.role == 'editor':
                    redirect_url = reverse('auth:password_setup') + '?role=editor'
                else:
                    redirect_url = '/'
            # Redirect based on user role
            elif user.is_superuser:
                redirect_url = reverse('system_admin:map')
            elif hasattr(user, 'profile') and user.profile.role:
                # Check permissions for managers and editors
                if user.profile.role == 'manager':
                    # Map is accessible without permissions, other pages require permissions
                    redirect_url = reverse('manager:map')
                elif user.profile.role == 'editor':
                    # Map is accessible without permissions, other pages require permissions
                    redirect_url = reverse('editor:map')
                else:
                    redirect_url = '/'
            else:
                redirect_url = '/'  # Regular users go to home page
            return JsonResponse({
                'success': True,
                'message': 'Login successful',
                'redirect_url': redirect_url,
                'notification': {'message': 'Login successful', 'type': 'success'}
            }, status=200)
        else:
            return JsonResponse({
                'success': False,
                'message': 'Invalid email or password',
                'notification': {'message': 'Invalid email or password', 'type': 'error'}
            }, status=401)
            
    except json.JSONDecodeError:
        return JsonResponse({
            'success': False,
            'message': 'Invalid JSON',
            'notification': {'message': 'Invalid JSON', 'type': 'error'}
        }, status=400)
    except Exception as e:
        return JsonResponse({
            'success': False,
            'message': str(e),
            'notification': {'message': str(e), 'type': 'error'}
        }, status=500)


@csrf_exempt
@require_http_methods(["POST"])
def onetime_api(request):
    """Handle System Admin registration API request."""
    # Block access if System Admin already exists
    if has_system_admin():
        return JsonResponse({
            'success': False,
            'message': 'System Admin has already been created. This route is no longer accessible.',
            'notification': {'message': 'System Admin has already been created. This route is no longer accessible.', 'type': 'error'}
        }, status=403)
    
    try:
        data = json.loads(request.body)
        full_name = data.get('full_name')
        email = data.get('email')
        password = data.get('password')
        confirm_password = data.get('confirm_password')
        
        # Validation
        if not full_name:
            return JsonResponse({
                'success': False,
                'message': 'Full name is required',
                'notification': {'message': 'Full name is required', 'type': 'error'}
            }, status=400)
        if not email:
            return JsonResponse({
                'success': False,
                'message': 'Email is required',
                'notification': {'message': 'Email is required', 'type': 'error'}
            }, status=400)
        if not password:
            return JsonResponse({
                'success': False,
                'message': 'Password is required',
                'notification': {'message': 'Password is required', 'type': 'error'}
            }, status=400)
        if password != confirm_password:
            return JsonResponse({
                'success': False,
                'message': 'Passwords do not match',
                'notification': {'message': 'Passwords do not match', 'type': 'error'}
            }, status=400)
        if len(password) < 8:
            return JsonResponse({
                'success': False,
                'message': 'Password must be at least 8 characters',
                'notification': {'message': 'Password must be at least 8 characters', 'type': 'error'}
            }, status=400)
        
        # Check if user already exists
        if User.objects.filter(username=email).exists():
            return JsonResponse({
                'success': False,
                'message': 'User with this email already exists',
                'notification': {'message': 'User with this email already exists', 'type': 'error'}
            }, status=400)
        
        # Create System Admin user
        user = User.objects.create_user(
            username=email,
            email=email,
            password=password,
            first_name=full_name.split()[0] if full_name.split() else '',
            last_name=' '.join(full_name.split()[1:]) if len(full_name.split()) > 1 else '',
            is_staff=True,
            is_superuser=True
        )
        
        # Create user profile with account creation date and time
        from system_admin.models import UserProfile
        profile = UserProfile.objects.create(user=user)
        profile.set_account_creation_datetime()
        
        return JsonResponse({
            'success': True,
            'message': 'System Admin created successfully',
            'notification': {'message': 'System Admin created successfully', 'type': 'success'}
        }, status=200)
            
    except json.JSONDecodeError:
        return JsonResponse({
            'success': False,
            'message': 'Invalid JSON',
            'notification': {'message': 'Invalid JSON', 'type': 'error'}
        }, status=400)
    except Exception as e:
        return JsonResponse({
            'success': False,
            'message': str(e),
            'notification': {'message': str(e), 'type': 'error'}
        }, status=500)


@login_required(login_url='/login/')
def password_setup_view(request):
    """First-time password setup view for Manager/Editor users."""
    # Only allow Manager and Editor roles
    if not hasattr(request.user, 'profile') or not request.user.profile.role:
        return redirect('auth:login')
    
    if request.user.profile.role not in ['manager', 'editor']:
        return redirect('auth:login')
    
    # If already completed, redirect to map
    if request.user.profile.password_setup_completed:
        if request.user.profile.role == 'manager':
            return redirect('manager:map')
        elif request.user.profile.role == 'editor':
            return redirect('editor:map')
    
    context = {
        'role': request.user.profile.role.title(),
    }
    
    if request.method == 'POST':
        intent = request.POST.get('intent')
        if intent == 'skip_password_setup':
            # Mark password setup as completed (skipped)
            request.user.profile.password_setup_completed = True
            request.user.profile.save()
            
            # Redirect to appropriate map
            if request.user.profile.role == 'manager':
                return redirect('manager:map')
            elif request.user.profile.role == 'editor':
                return redirect('editor:map')
        
        elif intent == 'set_password':
            errors = []
            new_password = request.POST.get('new_password', '').strip()
            confirm_password = request.POST.get('confirm_password', '').strip()
            
            if not new_password:
                errors.append('Password is required.')
            elif len(new_password) < 8:
                errors.append('Password must be at least 8 characters long.')
            
            if new_password != confirm_password:
                errors.append('Passwords do not match.')
            
            if not errors:
                # Set new password
                request.user.set_password(new_password)
                request.user.save()
                
                # Mark password setup as completed
                request.user.profile.password_setup_completed = True
                request.user.profile.save()
                
                # Re-login user with new password
                from django.contrib.auth import login
                login(request, request.user)
                
                context['password_set'] = True
                context['success_message'] = 'Password has been set successfully!'
                
                # Redirect after a moment
                if request.user.profile.role == 'manager':
                    return redirect('manager:map')
                elif request.user.profile.role == 'editor':
                    return redirect('editor:map')
            else:
                context['setup_errors'] = errors
    
    return render(request, 'auth/password_setup.html', context)


@login_required
def logout_view(request):
    """Handle logout."""
    logout(request)
    return redirect('auth:login')
