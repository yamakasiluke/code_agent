import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Box, Text} from 'ink';
import TextInput from 'ink-text-input';
import type {AgentResult} from '../agent/types.js';
import {ReactAgent} from '../agent/agent.js';
import {createDefaultTools} from '../tools/index.js';
import {DeepSeekClient} from '../llm/deepseekClient.js';
import {loadDeepSeekConfig} from '../config.js';

const AGENT_INSTRUCTIONS = `Follow the user's request for modifying or inspecting this repository.
Use the provided tools to discover facts about the codebase, and think critically before executing actions.
Once you have enough information, reply with a helpful explanation of what to change or what you observed.`;

type SessionStatus = 'running' | 'completed' | 'error' | 'aborted';

interface SessionEntry {
  id: number;
  request: string;
  status: SessionStatus;
  result?: AgentResult;
  error?: string;
}

const formatErrorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

const App = () => {
  const [prompt, setPrompt] = useState('');
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const sessionCounterRef = useRef(0);

  const {agent, configError} = useMemo(() => {
    try {
      const deepSeek = loadDeepSeekConfig();
      const llm = new DeepSeekClient(deepSeek);
      const tools = createDefaultTools();
      return {
        agent: new ReactAgent(llm, {
          instructions: AGENT_INSTRUCTIONS,
          tools
        }),
        configError: null
      };
    } catch (error) {
      return {
        agent: null,
        configError: formatErrorMessage(error)
      };
    }
  }, []);

  useEffect(() => () => abortControllerRef.current?.abort(), []);

  const runSession = useCallback(
    async (sessionId: number, task: string) => {
      if (!agent) {
        return;
      }

      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setActiveSessionId(sessionId);

      const patchSession = (patch: Partial<SessionEntry>) => {
        setSessions(prevSessions =>
          prevSessions.map(session => (session.id === sessionId ? {...session, ...patch} : session))
        );
      };

      try {
        const agentResult = await agent.run(task, {
          signal: controller.signal,
          cwd: process.cwd()
        });
        patchSession({status: 'completed', result: agentResult});
      } catch (error) {
        if ((error as Error)?.name === 'AbortError') {
          patchSession({
            status: 'aborted',
            error: 'Run aborted before completion (superseded by a newer request).'
          });
        } else {
          patchSession({status: 'error', error: formatErrorMessage(error)});
        }
      } finally {
        setActiveSessionId(current => (current === sessionId ? null : current));
      }
    },
    [agent]
  );

  const handleSubmit = useCallback(() => {
    const trimmed = prompt.trim();
    if (!trimmed.length || !agent) {
      return;
    }

    const sessionId = sessionCounterRef.current++;
    setSessions(prev => [
      {
        id: sessionId,
        request: trimmed,
        status: 'running'
      },
      ...prev
    ]);

    setPrompt('');
    void runSession(sessionId, trimmed);
  }, [agent, prompt, runSession]);

  const activeSession =
    activeSessionId === null ? null : sessions.find(session => session.id === activeSessionId) ?? null;

  return (
    <Box flexDirection="column">
      <Text color="cyan">Code Agent CLI</Text>
      <Text>Ink UX · DeepSeek LLM · ReAct orchestration</Text>

      {configError && (
        <Box marginTop={1} flexDirection="column">
          <Text color="red">Configuration error</Text>
          <Text>
            {configError} Set DEEPSEEK_API_KEY (and optionally DEEPSEEK_MODEL) before starting the
            agent.
          </Text>
        </Box>
      )}

      <Box marginTop={1} flexDirection="column">
        <Text>Describe your coding task to get started (submit as many times as you like):</Text>
        <Box>
          <Text color="green">› </Text>
          <TextInput
            value={prompt}
            onChange={setPrompt}
            onSubmit={handleSubmit}
            placeholder="e.g. implement a DeepSeek client wrapper"
            focus={!configError}
            isDisabled={!agent}
          />
        </Box>
      </Box>

      {activeSession && (
        <Box marginTop={1} flexDirection="column">
          <Text color="yellow">Running:</Text>
          <Text>{activeSession.request}</Text>
          <Text dimColor>Thinking with ReAct…</Text>
        </Box>
      )}

      <Box marginTop={1} flexDirection="column">
        <Text color="cyan">Run history</Text>
        {sessions.length === 0 ? (
          <Text dimColor>No agent runs yet. Submit a request above.</Text>
        ) : (
          sessions.map(session => (
            <Box key={session.id} marginTop={1} flexDirection="column">
              <Text>
                <Text color="magenta">Request:</Text> {session.request}
              </Text>
              {session.status === 'running' && <Text color="yellow">Status: running…</Text>}
              {session.status === 'aborted' && (
                <Text color="yellow">Status: aborted (newer request started).</Text>
              )}
              {session.status === 'error' && session.error && (
                <Text color="red">Error: {session.error}</Text>
              )}
              {session.status === 'completed' && session.result && (
                <>
                  <Text color="green">Final response</Text>
                  <Text>{session.result.output}</Text>
                  {session.result.thoughts.map((thought, index) => (
                    <Box key={index} marginTop={1} flexDirection="column" marginLeft={2}>
                      <Text color="cyan">Step {index + 1}</Text>
                      <Text>Thought: {thought.thought}</Text>
                      {thought.action && (
                        <Text>
                          Action: {thought.action.toolName} → {thought.action.input}
                        </Text>
                      )}
                      {thought.observation && <Text>Observation: {thought.observation}</Text>}
                    </Box>
                  ))}
                </>
              )}
            </Box>
          ))
        )}
      </Box>
    </Box>
  );
};

export default App;
