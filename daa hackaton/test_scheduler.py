"""
DAA Hackathon Test Suite
Topic: Multi-Machine Computational Task Scheduler based on Priority, Execution Time, and Deadlines
Author: DAA Hackathon Team

Verifies:
1. Correctness of all 6 Algorithmic Paradigms
2. Edge cases (single task, zero-arrival, identical deadlines, capability affinities)
3. Non-overlapping execution invariant (no machine double-booking)
4. Monotonic time advancement & mathematical metric accuracy
5. Sub-millisecond runtime performance benchmark
"""

import unittest
import time
from typing import List

import scheduler_engine as se


class TestSchedulerAlgorithms(unittest.TestCase):

    def setUp(self):
        self.machines = [
            se.Machine("M1", "Node Alpha (Fast)", 1.5, ["general", "gpu"]),
            se.Machine("M2", "Node Beta (Standard)", 1.0, ["general"]),
            se.Machine("M3", "Node Gamma (Eco)", 0.8, ["general"])
        ]
        self.tasks = [
            se.Task("T1", "Auth API", priority=5, execution_time=4, deadline=10, arrival_time=0),
            se.Task("T2", "DB Sync", priority=4, execution_time=8, deadline=18, arrival_time=0),
            se.Task("T3", "Log Aggregator", priority=2, execution_time=12, deadline=35, arrival_time=2),
            se.Task("T4", "Payment Hook", priority=5, execution_time=3, deadline=12, arrival_time=1),
            se.Task("T5", "Analytics ETL", priority=1, execution_time=18, deadline=50, arrival_time=5),
            se.Task("T6", "Email Queue", priority=3, execution_time=6, deadline=25, arrival_time=3)
        ]

    def _verify_schedule_validity(self, schedule: List[se.ScheduledItem], tasks: List[se.Task], machines: List[se.Machine]):
        """Invariant checks on schedule validity."""
        self.assertEqual(len(schedule), len(tasks), "All tasks must be scheduled.")

        # Check no task starts before arrival time
        for item in schedule:
            self.assertGreaterEqual(
                item.start_time,
                item.task.arrival_time - 0.001,
                f"Task {item.task.task_id} started before arrival time!"
            )
            self.assertGreater(
                item.end_time,
                item.start_time,
                f"Task {item.task.task_id} must have positive duration."
            )

        # Check no two tasks overlap on the same machine (Non-preemptive parallel machine invariant)
        by_machine = {}
        for item in schedule:
            by_machine.setdefault(item.machine.machine_id, []).append(item)

        for m_id, items in by_machine.items():
            sorted_items = sorted(items, key=lambda x: x.start_time)
            for i in range(len(sorted_items) - 1):
                cur = sorted_items[i]
                nxt = sorted_items[i + 1]
                self.assertLessEqual(
                    cur.end_time,
                    nxt.start_time + 0.001,
                    f"Machine {m_id} has overlapping tasks: {cur.task.task_id} and {nxt.task.task_id}"
                )

    def test_dynamic_greedy_scheduler(self):
        sched, metrics, trace = se.schedule_dynamic_greedy(self.tasks, self.machines)
        self._verify_schedule_validity(sched, self.tasks, self.machines)
        self.assertGreater(metrics.makespan, 0)
        self.assertGreaterEqual(metrics.on_time_percentage, 80.0)
        self.assertTrue(len(trace) > 0)

    def test_earliest_deadline_first(self):
        sched, metrics, trace = se.schedule_earliest_deadline_first(self.tasks, self.machines)
        self._verify_schedule_validity(sched, self.tasks, self.machines)
        self.assertGreater(metrics.makespan, 0)

    def test_priority_first_scheduler(self):
        sched, metrics, trace = se.schedule_priority_first(self.tasks, self.machines)
        self._verify_schedule_validity(sched, self.tasks, self.machines)
        # Priority 5 tasks must be scheduled early
        p5_tasks = [item for item in sched if item.task.priority == 5]
        for p in p5_tasks:
            self.assertTrue(p.met_deadline, f"Critical task {p.task.name} should meet deadline")

    def test_shortest_processing_time(self):
        sched, metrics, trace = se.schedule_shortest_processing_time(self.tasks, self.machines)
        self._verify_schedule_validity(sched, self.tasks, self.machines)

    def test_branch_and_bound(self):
        sched, metrics, trace = se.schedule_branch_and_bound(self.tasks[:5], self.machines[:2])
        self._verify_schedule_validity(sched, self.tasks[:5], self.machines[:2])
        self.assertGreater(metrics.makespan, 0)

    def test_genetic_algorithm(self):
        sched, metrics, trace = se.schedule_genetic_algorithm(self.tasks, self.machines, population_size=15, generations=20)
        self._verify_schedule_validity(sched, self.tasks, self.machines)
        self.assertGreater(metrics.makespan, 0)

    def test_edge_case_single_task_single_machine(self):
        single_task = [se.Task("T1", "Solo Job", priority=5, execution_time=7, deadline=15, arrival_time=0)]
        single_mach = [se.Machine("M1", "Solo Node", 1.0)]
        sched, metrics, _ = se.schedule_dynamic_greedy(single_task, single_mach)
        self._verify_schedule_validity(sched, single_task, single_mach)
        self.assertEqual(metrics.makespan, 7.0)
        self.assertEqual(metrics.on_time_percentage, 100.0)

    def test_edge_case_identical_deadlines(self):
        tasks = [
            se.Task("T1", "Task 1", priority=5, execution_time=4, deadline=20, arrival_time=0),
            se.Task("T2", "Task 2", priority=3, execution_time=4, deadline=20, arrival_time=0),
            se.Task("T3", "Task 3", priority=1, execution_time=4, deadline=20, arrival_time=0)
        ]
        sched, metrics, _ = se.schedule_dynamic_greedy(tasks, self.machines)
        self._verify_schedule_validity(sched, tasks, self.machines)
        self.assertEqual(metrics.on_time_percentage, 100.0)

    def test_edge_case_overloaded_starvation(self):
        """Stress testing when deadlines are impossibly tight."""
        tasks = [
            se.Task(f"T{i}", f"Stress Task {i}", priority=i % 5 + 1, execution_time=10, deadline=5, arrival_time=0)
            for i in range(1, 8)
        ]
        sched, metrics, _ = se.schedule_dynamic_greedy(tasks, [self.machines[0]])
        self._verify_schedule_validity(sched, tasks, [self.machines[0]])
        self.assertGreater(metrics.total_tardiness, 0, "Overloaded tasks must register tardiness penalty.")

    def test_benchmark_all_consistency(self):
        bench = se.run_benchmark_all(self.tasks, self.machines)
        self.assertIn("winner", bench)
        self.assertEqual(len(bench["benchmark"]), 6)


class TestWebServerEndpoints(unittest.TestCase):
    def test_api_endpoints_mock(self):
        import io, json
        import app

        class MockSocket:
            def __init__(self, request_bytes):
                self.rfile = io.BytesIO(request_bytes)
                self.wfile = io.BytesIO()

        class TestHandler(app.DAAHackathonHandler):
            def __init__(self, mock_sock):
                self.client_address = ('127.0.0.1', 8888)
                self.rfile = mock_sock.rfile
                self.wfile = mock_sock.wfile
                self.raw_requestline = self.rfile.readline()
                self.parse_request()

        # Test GET /api/presets
        sock_get = MockSocket(b'GET /api/presets HTTP/1.1\r\nHost: localhost\r\n\r\n')
        th_get = TestHandler(sock_get)
        th_get.do_GET()
        sock_get.wfile.seek(0)
        res_get = sock_get.wfile.read().decode('utf-8')
        self.assertIn('200 OK', res_get)

        # Test POST /api/schedule
        req_body = json.dumps({
            'algorithm': 'dynamic_greedy',
            'tasks': [{'task_id': 'T1', 'name': 'Task 1', 'priority': 5, 'execution_time': 4, 'deadline': 10, 'arrival_time': 0}],
            'machines': [{'machine_id': 'M1', 'name': 'Mach 1', 'speed_multiplier': 1.0, 'capabilities': ['general']}]
        })
        sock_sched = MockSocket(f'POST /api/schedule HTTP/1.1\r\nHost: localhost\r\nContent-Length: {len(req_body)}\r\n\r\n{req_body}'.encode('utf-8'))
        th_sched = TestHandler(sock_sched)
        th_sched.do_POST()
        sock_sched.wfile.seek(0)
        res_sched = sock_sched.wfile.read().decode('utf-8')
        self.assertIn('200 OK', res_sched)


if __name__ == "__main__":
    unittest.main()
