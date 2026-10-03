#!/usr/bin/env python3
"""
DAA Hackathon Web Server
Topic: Multi-Machine Computational Task Scheduling based on Priority, Execution Time, and Deadlines
Author: DAA Hackathon Team
Features:
- Pure Python 3 standard library (zero external dependencies required)
- Serves single-page application & REST API
- Endpoints for Scheduling, Benchmarking, Presets, and Workload Generation
"""

import http.server
import socketserver
import json
import urllib.parse
import os
import sys
from typing import Dict, Any

import scheduler_engine as engine

PORT = int(os.environ.get("PORT", 5000))
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")


class DAAHackathonHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=STATIC_DIR, **kwargs)

    def _send_json_response(self, data: Dict[str, Any], status_code: int = 200):
        response_bytes = json.dumps(data, indent=2).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(response_bytes)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(response_bytes)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/api/presets":
            presets = engine.get_curated_presets()
            self._send_json_response({"status": "success", "presets": presets})
            return

        if path == "/api/algorithms":
            algos = {
                k: {
                    "name": v["name"],
                    "acronym": v["acronym"],
                    "paradigm": v["paradigm"],
                    "time_complexity": v["time_complexity"],
                    "space_complexity": v["space_complexity"],
                    "description": v["description"]
                }
                for k, v in engine.ALGORITHMS.items()
            }
            self._send_json_response({"status": "success", "algorithms": algos})
            return

        if path == "/api/random":
            qs = urllib.parse.parse_qs(parsed.query)
            n_tasks = int(qs.get("tasks", [12])[0])
            n_machs = int(qs.get("machines", [3])[0])
            n_tasks = max(3, min(200, n_tasks))
            n_machs = max(1, min(10, n_machs))
            workload = engine.generate_random_workload(n_tasks, n_machs)
            self._send_json_response({"status": "success", "workload": workload})
            return

        # Fallback to static files
        super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        try:
            content_length = int(self.headers.get("Content-Length", 0))
            body_bytes = self.rfile.read(content_length)
            body = json.loads(body_bytes.decode("utf-8")) if body_bytes else {}
        except Exception as e:
            self._send_json_response({"status": "error", "message": f"Malformed JSON: {str(e)}"}, 400)
            return

        if path == "/api/schedule":
            algo_key = body.get("algorithm", "dynamic_greedy")
            raw_tasks = body.get("tasks", [])
            raw_machines = body.get("machines", [])

            if not raw_tasks or not raw_machines:
                self._send_json_response({
                    "status": "error",
                    "message": "Both tasks and machines lists are required."
                }, 400)
                return

            tasks = [engine.Task.from_dict(t) for t in raw_tasks]
            machines = [engine.Machine.from_dict(m) for m in raw_machines]

            if algo_key not in engine.ALGORITHMS:
                algo_key = "dynamic_greedy"

            algo_info = engine.ALGORITHMS[algo_key]

            # Optional weight parameters for Dynamic Greedy
            if algo_key == "dynamic_greedy":
                w_p = float(body.get("w_priority", 3.0))
                w_d = float(body.get("w_deadline", 2.5))
                w_e = float(body.get("w_exec", 1.0))
                sched, metrics, trace = engine.schedule_dynamic_greedy(tasks, machines, w_p, w_d, w_e)
            else:
                sched, metrics, trace = algo_info["func"](tasks, machines)

            self._send_json_response({
                "status": "success",
                "algorithm": {
                    "key": algo_key,
                    "name": algo_info["name"],
                    "acronym": algo_info["acronym"],
                    "paradigm": algo_info["paradigm"],
                    "time_complexity": algo_info["time_complexity"],
                    "space_complexity": algo_info["space_complexity"],
                    "description": algo_info["description"]
                },
                "schedule": [item.to_dict() for item in sched],
                "metrics": metrics.to_dict(),
                "trace": trace
            })
            return

        if path == "/api/benchmark":
            raw_tasks = body.get("tasks", [])
            raw_machines = body.get("machines", [])

            if not raw_tasks or not raw_machines:
                self._send_json_response({
                    "status": "error",
                    "message": "Tasks and machines are required for benchmark."
                }, 400)
                return

            tasks = [engine.Task.from_dict(t) for t in raw_tasks]
            machines = [engine.Machine.from_dict(m) for m in raw_machines]

            benchmark_result = engine.run_benchmark_all(tasks, machines)
            self._send_json_response({
                "status": "success",
                "data": benchmark_result
            })
            return

        self._send_json_response({"status": "error", "message": "Endpoint not found"}, 404)


def run_server():
    os.makedirs(STATIC_DIR, exist_ok=True)
    socketserver.TCPServer.allow_reuse_address = True
    
    ports_to_try = [5000, 5050, 8080, 8000, 8888, 3000, 5500]
    httpd = None
    active_port = None
    
    for p in ports_to_try:
        try:
            httpd = socketserver.ThreadingTCPServer(("127.0.0.1", p), DAAHackathonHandler)
            active_port = p
            break
        except OSError:
            continue
            
    if not httpd:
        try:
            httpd = socketserver.ThreadingTCPServer(("127.0.0.1", 0), DAAHackathonHandler)
            active_port = httpd.server_address[1]
        except Exception as e:
            print(f"Failed to start server: {e}")
            sys.exit(1)

    with open(".server_info.json", "w") as f:
        json.dump({"port": active_port, "url": f"http://127.0.0.1:{active_port}"}, f)

    print(f"==================================================")
    print(f"🚀 DAA Hackathon Server running at: http://127.0.0.1:{active_port}")
    print(f"📁 Serving static files from: {STATIC_DIR}")
    print(f"Press Ctrl+C to terminate.")
    print(f"==================================================")
    
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server cleanly...")
        httpd.server_close()


if __name__ == "__main__":
    run_server()
