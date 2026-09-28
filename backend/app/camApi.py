# Import Dependencies
import requests
import warnings
import time
import os

# CAM Api Set Up - Uses Device Environment to Find Api Key-
api = os.environ['EPA_KEY']
url = 'https://api.epa.gov/easey'

# Retrival Functions
def requestAgain(retr: str, header: dict):
    # Recursive Request Retry for Rate Limits
    response = requests.get(retr, params=header)

    # Same Logic as Status Matching
    match(response.status_code):
        case 200:
            return response
        case 400:
            raise ValueError("Invalid Request")
        case 404:
            raise LookupError("Resource Not Found")
        case 429:
            # Limit Rated, Wait and Attempt Again
            warnings.warn("Api Rate Limited - Waiting 10 Seconds")
            time.sleep(10)
            # Try Again
            return requestAgain(retr, header)
        case _:
            raise ValueError(f"Unknown Error, Status: {response.status_code}")

def retrFacility(args: dict):
    # Build Parameters and Create a Request
    header = {'perPage': 1, 'api_key': api}

    # Change perPage if Included in args
    if 'perPage' in args:
        header['perPage'] = args['perPage']
    header = header | args

    # Get Request and Match Status for Return
    retr = f'{url}/facilities-mgmt/facilities/attributes'
    response = requests.get(retr, params=header)
    match(response.status_code):
        case 200:
            return response
        case 400:
            raise ValueError("Invalid Request")
        case 404:
            raise LookupError("Resource Not Found")
        case 429:
            # Limit Rated, Wait and Attempt Again
            warnings.warn("Api Rate Limited - Waiting 10 Seconds")
            time.sleep(10)
            return requestAgain(retr, header)
        case _:
            raise ValueError(f"Unknown Error, Status: {response.status_code}")

def retrEmission(args: dict):
    # Preserve Arguments In-Case of Retry
    arguments = args.copy()

    arguments['api_key'] = api
    # Use arguments to Build URL
    retr = f'{url}/emissions-mgmt/emissions/apportioned/'
    if 'period' not in arguments:
        raise ValueError("Missing period Parameter")
    retr = retr + arguments['period']
    if 'by' in arguments:
        retr = retr + '/by-' + args['by']

        # Delete URL Parameters
        del arguments['by']
    del arguments['period']

    # Return Filtered Emission Data
    response = requests.get(retr, params=arguments)
    match(response.status_code):
        case 200:
            return response
        case 400:
            raise ValueError("Invalid Request")
        case 404:
            raise LookupError("Resource Not Found")
        case 429:
            # Limit Rated, Wait and Attempt Again
            warnings.warn("Api Rate Limited - Waiting 10 Seconds")
            time.sleep(10)
            return requestAgain(retr, args)
        case _:
            raise ValueError(f"Unknown Error, Status: {response.status_code}")