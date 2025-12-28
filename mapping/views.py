from django.shortcuts import render, get_object_or_404
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods
from django.contrib.auth.decorators import login_required
from django.views.decorators.csrf import csrf_exempt
from django.utils import timezone
import json
from .models import LineEditRequest
from django.middleware.csrf import get_token


def map_view(request):
    """KSA Map Editing Module view."""
    return render(request, 'mapping/map.html')


@login_required
@require_http_methods(["POST"])
@csrf_exempt
def save_line_edit_request(request):
    """Save a line edit request from Editor, System Admin, or Manager."""
    try:
        data = json.loads(request.body.decode('utf-8'))
        
        # Validate required fields
        if 'geometry' not in data:
            return JsonResponse({
                'success': False,
                'message': 'Geometry is required'
            }, status=400)
        
        # Check if user is manager
        profile = getattr(request.user, 'profile', None)
        is_manager = profile and profile.role == 'manager'
        
        # Create the edit request
        edit_request = LineEditRequest.objects.create(
            requester=request.user,
            geometry=data.get('geometry'),
            feature_type=data.get('feature_type', ''),
            current_feature_label=data.get('current_feature_label', 'Line'),
            fields_data=data.get('fields_data', {}),
            tags_data=data.get('tags_data', []),
            relations_data=data.get('relations_data', []),
            parent_approved_line_id=int(data.get('approved_line_id')) if data.get('approved_line_id') else None
        )
        
        # Only managers get auto-approved - SYSTEM ADMIN and EDITOR require approval
        if is_manager:
            edit_request.approve(request.user)
            return JsonResponse({
                'success': True,
                'message': 'Edit saved successfully!',
                'request_id': edit_request.id,
                'auto_approved': True
            })
        else:
            # Editor or System Admin - requires approval from manager
            return JsonResponse({
                'success': True,
                'message': 'Your requested edit has been sent to Manager and will be approved/rejected accordingly.',
                'request_id': edit_request.id,
                'auto_approved': False
            })
        
    except json.JSONDecodeError:
        return JsonResponse({
            'success': False,
            'message': 'Invalid JSON data'
        }, status=400)
    except Exception as e:
        return JsonResponse({
            'success': False,
            'message': f'Error saving edit request: {str(e)}'
        }, status=500)


@login_required
def list_pending_requests(request):
    """List all pending line edit requests for Manager."""
    # Check if user is manager
    profile = getattr(request.user, 'profile', None)
    is_manager = profile and profile.role == 'manager'
    is_superuser = request.user.is_superuser
    
    if not (is_manager or is_superuser):
        return JsonResponse({
            'success': False,
            'message': 'Unauthorized'
        }, status=403)
    
    try:
        requests = LineEditRequest.objects.filter(status='pending').select_related('requester', 'requester__profile').order_by('-created_at')
        
        requests_data = []
        for req in requests:
            profile = getattr(req.requester, 'profile', None)
            profile_image_url = profile.profile_image.url if profile and profile.profile_image else None
            
            requests_data.append({
                'id': req.id,
                'requester_name': req.requester.get_full_name() or req.requester.username,
                'requester_username': req.requester.username,
                'requester_role': req.get_requester_role(),
                'profile_image_url': profile_image_url,
                'edit_type': req.edit_type,
                'feature_type': req.current_feature_label or 'Line',
                'created_at': req.created_at.isoformat(),
                'geometry': req.geometry
            })
        
        return JsonResponse({
            'success': True,
            'requests': requests_data
        })
        
    except Exception as e:
        return JsonResponse({
            'success': False,
            'message': f'Error fetching requests: {str(e)}'
        }, status=500)


@login_required
def get_edit_request_details(request, request_id):
    """Get full details of an edit request."""
    # Check if user is manager
    profile = getattr(request.user, 'profile', None)
    is_manager = profile and profile.role == 'manager'
    is_superuser = request.user.is_superuser
    
    if not (is_manager or is_superuser):
        return JsonResponse({
            'success': False,
            'message': 'Unauthorized'
        }, status=403)
    
    try:
        edit_request = get_object_or_404(LineEditRequest, id=request_id)
        
        profile = getattr(edit_request.requester, 'profile', None)
        profile_image_url = profile.profile_image.url if profile and profile.profile_image else None
        
        return JsonResponse({
            'success': True,
            'request': {
                'id': edit_request.id,
                'requester_name': edit_request.requester.get_full_name() or edit_request.requester.username,
                'requester_username': edit_request.requester.username,
                'requester_role': edit_request.get_requester_role(),
                'profile_image_url': profile_image_url,
                'edit_type': edit_request.edit_type,
                'feature_type': edit_request.current_feature_label or 'Line',
                'current_feature_label': edit_request.current_feature_label or 'Line',
                'geometry': edit_request.geometry,
                'fields_data': edit_request.fields_data or {},
                'tags_data': edit_request.tags_data or [],
                'relations_data': edit_request.relations_data or [],
                'created_at': edit_request.created_at.isoformat()
            }
        })
        
    except Exception as e:
        return JsonResponse({
            'success': False,
            'message': f'Error fetching request details: {str(e)}'
        }, status=500)


@login_required
@require_http_methods(["POST"])
@csrf_exempt
def approve_edit_request(request, request_id):
    """Approve an edit request."""
    # Check if user is manager
    profile = getattr(request.user, 'profile', None)
    is_manager = profile and profile.role == 'manager'
    is_superuser = request.user.is_superuser
    
    if not (is_manager or is_superuser):
        return JsonResponse({
            'success': False,
            'message': 'Unauthorized'
        }, status=403)
    
    try:
        edit_request = get_object_or_404(LineEditRequest, id=request_id, status='pending')
        edit_request.approve(request.user)
        
        return JsonResponse({
            'success': True,
            'message': 'Edit request approved successfully'
        })
        
    except Exception as e:
        return JsonResponse({
            'success': False,
            'message': f'Error approving request: {str(e)}'
        }, status=500)


@login_required
@require_http_methods(["POST"])
@csrf_exempt
def reject_edit_request(request, request_id):
    """Reject an edit request."""
    # Check if user is manager
    profile = getattr(request.user, 'profile', None)
    is_manager = profile and profile.role == 'manager'
    is_superuser = request.user.is_superuser
    
    if not (is_manager or is_superuser):
        return JsonResponse({
            'success': False,
            'message': 'Unauthorized'
        }, status=403)
    
    try:
        edit_request = get_object_or_404(LineEditRequest, id=request_id, status='pending')
        edit_request.reject(request.user)
        
        return JsonResponse({
            'success': True,
            'message': 'Edit request rejected'
        })
        
    except Exception as e:
        return JsonResponse({
            'success': False,
            'message': f'Error rejecting request: {str(e)}'
        }, status=500)


@login_required
def get_approved_lines(request):
    """Get all approved lines to display on map.
    Excludes superseded lines (old versions that have been edited).
    """
    try:
        approved_requests = LineEditRequest.objects.filter(status='approved').order_by('-created_at')
        
        # Collect IDs of lines that have been superseded by newer versions
        superseded_ids = set()
        for req in approved_requests:
            if req.parent_approved_line_id:
                superseded_ids.add(int(req.parent_approved_line_id))
        
        # Build response with only non-superseded lines
        lines_data = []
        for req in approved_requests:
            if req.id not in superseded_ids:
                lines_data.append({
                    'id': req.id,
                    'geometry': req.geometry,
                    'feature_type': req.current_feature_label or 'Line',
                    'current_feature_label': req.current_feature_label or 'Line',
                    'fields_data': req.fields_data or {},
                    'tags_data': req.tags_data or [],
                    'relations_data': req.relations_data or []
                })
        
        return JsonResponse({
            'success': True,
            'lines': lines_data
        })
        
    except Exception as e:
        return JsonResponse({
            'success': False,
            'message': f'Error fetching approved lines: {str(e)}'
        }, status=500)
