from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

def test_health_check_endpoint():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert "mode" in data

def test_config_endpoint():
    response = client.get("/config")
    assert response.status_code == 200
    data = response.json()
    assert "mode" in data
    assert "groq_available" in data

def test_websocket_connect():
    with client.websocket_connect("/ws/transcribe") as websocket:
        # Just connect and close to verify handshake
        pass

def test_websocket_invalid_json():
    with client.websocket_connect("/ws/transcribe") as websocket:
        websocket.send_text("not json")
        # Should gracefully handle or ignore, but connection remains until error sent
        # Backend implementation sends error json then continues
        data = websocket.receive_json()
        assert "error" in data
