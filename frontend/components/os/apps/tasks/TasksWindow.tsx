"use client";

import { useCallback } from "react";
import { useKernel } from "@/components/os/kernel/KernelProvider";
import TasksApp from "@/components/os/apps/tasks/TasksApp";

type TasksWindowProps = {
  windowId: string;
};

const TASKS_DEFAULT_WIDTH = 1000;
const TASKS_EXPANDED_WIDTH = 1400;
const TASKS_HEIGHT = 700;

export default function TasksWindow({ windowId }: TasksWindowProps) {
  const { resizeWindow } = useKernel();

  const handleDetailOpenChange = useCallback(
    (detailOpen: boolean) => {
      resizeWindow(
        windowId,
        detailOpen ? TASKS_EXPANDED_WIDTH : TASKS_DEFAULT_WIDTH,
        TASKS_HEIGHT
      );
    },
    [resizeWindow, windowId]
  );

  return <TasksApp onDetailOpenChange={handleDetailOpenChange} />;
}

