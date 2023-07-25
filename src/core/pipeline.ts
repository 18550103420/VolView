// declare type Awaitable<T> = Promise<T> | T;
import { Awaitable } from '@vueuse/core';

import { Maybe } from '@/src/types';

import { defer, partition } from '../utils';

/**
 * Represents a pipeline error.
 *
 * The inputDataStackTrace property provides the inputs that caused the error.
 * inputDataStackTrace属性提供了导致错误的输入。
 *
 * It is ordered by nested level, starting with the inner most execution context
 * 它是按嵌套级别排序的，从最内部的执行上下文开始
 *
 * input.
 *
 * The cause property refers to the original thrown object that resulted in the
 * cause属性引用导致
 * error.
 */
export interface PipelineError<DataType> {
  message: string;
  inputDataStackTrace: DataType[];
  cause: unknown;
}

/**
 * Represents a pipeline's execution result.
 * 表示管道的执行结果
 *
 * The data property holds any return values from handlers.
 * data属性保存处理程序的任何返回值
 *
 * The errors property holds any errors reported from (potentially nested)
 * executions.
 * errors属性包含任何错误(可能是嵌套的)
 */
export interface PipelineResult<DataType, ResultType> {
  ok: boolean;
  data: ResultType[];
  errors: PipelineError<DataType>[];
}

function createPipelineError<DataType>(
  message: string,
  input: DataType,
  cause: unknown
) {
  return {
    message,
    inputDataStackTrace: [input],
    cause,
  };
}

export interface IPipeline<DataType, ResultType> {
  /**
   * Runs a given input through a middleware pipeline.
   * @param input
   */
  execute(input: DataType): Promise<PipelineResult<DataType, ResultType>>;
}

const DoneSentinel: symbol = Symbol('DoneSentinel');
type DoneSentinelType = symbol;
export type Done<Out> = (out?: Out) => DoneSentinelType;

export interface PipelineContext<DataType, ResultType, ExtraContext> {
  /**
   * Terminate the pipeline with an optional pipeline return value.
   * @param pipelineReturn
   */
  done: Done<ResultType>;
  /**
   * Execute the pipeline with the given input.
   * @param input
   */
  execute(
    input: DataType,
    extra?: ExtraContext
  ): Promise<PipelineResult<DataType, ResultType>>;
  /**
   * Any extra user-supplied data.
   */
  extra?: ExtraContext;
}

/**
 * Represents an element/step of a pipeline.
 * 表示管道的元素/步骤
 *
 * Handlers have three pipeline operations availble to them:
 * 处理程序有三种管道操作可供使用：
 * - process input and produce output for the rest of the pipeline
 * - 为管道的其余部分处理输入和生产输出
 * - terminate the pipeline and optionally produce a result
 * - 终止管道并可选择产生结果
 * - start a nested execution of the pipeline with new data
 * - 使用新数据启动管道的嵌套执行
 *
 * Handlers receive input data via the `input` parameter and pass data down the
 * pipeline by returning. Pipeline execution will await asynchronous handlers if
 * they return a Promise that resolves to the output data.
 * 处理程序通过“input”参数接收输入数据，并通过管道返回。
 * 如果出现以下情况，管道执行将等待异步处理程序它们返回一个解析为输出数据的Promise
 *
 * The second argument to a handler is a context object containing an
 * `execute()` method and a `done()` method.
 * 处理程序的第二个参数是包含execute方法和done方法的对象
 *
 * A handler is free to start new pipeline executions by calling
 * `execute(input)`.  The handler does not need to await the `execute` call, as
 * the top-level pipeline will track all nested executions.
 * 处理程序可以通过调用`execute(input)`来自由启动新的管道执行
 * 处理程序不需要等待“execute”调用，因为顶级管道将跟踪所有嵌套的执行
 *
 * If a handler wishes to terminate the pipeline, it must call `done()`. This
 * will signal the pipeline to terminate after the handler returns.  An optional
 * pipeline result value can be passed as the single argument to `done(output)`.
 * If `done()` is signalled, then the handler's return value is ignored.
 * 如果处理程序希望终止管道，则必须调用`done()`.这将在处理程序返回后用信号通知管道终止
 * 可选管道结果值可以作为`done(output)`的单个参数传递,如果发出`done()`信号，则忽略处理程序的返回值
 *
 * To facilitate typing and to avoid accidentally forgetting to return a value
 * in a handler, handlers are typed to return either the DataType or the return
 * value of done().
 * 为了便于键入并避免意外忘记返回值,在处理程序中，处理程序的类型是返回DataType或返回done()的值
 */
export type Handler<
  DataType,
  ResultType = undefined,
  ExtraContext = undefined
> = (
  input: DataType,
  context: PipelineContext<DataType, ResultType, ExtraContext>
) => Awaitable<DataType | DoneSentinelType>;

/**
 * Represents an executable pipeline.
 * 表示可执行管道
 *
 * Features supported:
 * 支持的功能:
 * - Execution of a pipeline in the given order of the provided handlers
 * - 按照所提供处理程序的给定顺序执行管道
 * - Handlers can run nested executions of the same pipeline
 * - 处理程序可以运行同一管道的嵌套执行
 * - Handlers can optionally transform data for downstream use
 * - 处理程序可以选择性地转换数据以供下游使用
 * - Early termination
 * - 提前终止
 * - Reporting errors. This includes un-nesting errors from nested executions.
 * - 报告错误。这包括嵌套执行中的取消嵌套错误
 * - Reporting data returned from terminating handlers, if any.
 * - 报告从终止处理程序返回的数据（如果有）。
 */
export default class Pipeline<
  DataType,
  ResultType = undefined,
  ExtraContext = undefined
> implements IPipeline<DataType, ResultType>
{
  private handlers: Handler<DataType, ResultType, ExtraContext>[];

  constructor(handlers?: Handler<DataType, ResultType, ExtraContext>[]) {
    this.handlers = Array.from(handlers ?? []);
  }

  /**
   * Executes the pipeline with a given input.
   * 使用给定的输入执行管道
   *
   * This method will resolve once this execution context and all
   * nested execution contexts have finished, allowing for aggregate
   * error reporting.
   * 一旦此执行上下文和所有嵌套执行上下文已完成，允许聚合错误报告
   *
   * Extra context data can be passed to all handlers via the `.extra` property.
   * In nested execution scenarios, handlers may choose to pass their own extra
   * context data into `execute(arg, extra)`. If none is supplied, the extra
   * context data from the outermost `execute()` call is used.
   * 额外的上下文数据可以通过“.Extra”属性传递给所有处理程序.
   * 在嵌套执行场景中,处理程序可以选择传递自己的额外将上下文数据转换为`execute(arg,extra)`.
   * 如果没有提供,则额外使用来自最外层`execute()`调用的上下文数据
   *
   * @param input
   * @param extraContext
   * @returns {PipelineResult}
   */
  async execute(input: DataType, extraContext?: ExtraContext) {
    return this.startExecutionContext(input, extraContext);
  }

  private async startExecutionContext(
    input: DataType,
    extraContext?: ExtraContext
  ) {
    const handlers = [...this.handlers];
    const nestedExecutions: Array<
      Promise<PipelineResult<DataType, ResultType>>
    > = [];
    const execution = defer<Maybe<ResultType>>();

    const terminate = (result: Maybe<ResultType>, error?: Error) => {
      if (error) {
        execution.reject(error);
      } else {
        execution.resolve(result);
      }
    };

    const invokeHandler = async (data: DataType, index: number) => {
      let doneInvoked = false;
      // eslint-disable-next-line no-undef-init
      let pipelineResult: ResultType | undefined = undefined;
      const endOfPipeline = index >= handlers.length;

      const context: PipelineContext<DataType, ResultType, ExtraContext> = {
        done: (out?: ResultType): DoneSentinelType => {
          if (doneInvoked) {
            throw new Error('done() called twice!');
          }

          doneInvoked = true;
          pipelineResult = out;
          return DoneSentinel;
        },
        execute: async (arg: DataType, innerExtra?: ExtraContext) => {
          const promise = this.execute(arg, innerExtra ?? extraContext);
          nestedExecutions.push(promise);
          return promise;
        },
        extra: extraContext,
      };

      let output: DataType | DoneSentinelType;

      if (endOfPipeline) {
        output = DoneSentinel;
      }

      try {
        if (endOfPipeline) {
          output = DoneSentinel;
        } else {
          const handler = handlers[index];
          output = await handler(data, context);
        }
      } catch (thrown) {
        const error =
          thrown instanceof Error
            ? thrown
            : new Error(thrown ? String(thrown) : 'Unknown error occurred');
        terminate(undefined, error);
        return;
      }

      if (doneInvoked || endOfPipeline) {
        terminate(pipelineResult);
        return;
      }

      invokeHandler(output as DataType, index + 1);
    };

    const result: PipelineResult<DataType, ResultType> = {
      ok: true,
      data: [],
      errors: [],
    };

    try {
      await invokeHandler(input, 0);
      const ret = await execution.promise;
      if (ret != null) {
        result.data.push(ret);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.ok = false;
      result.errors.push(createPipelineError(message, input, err));
    }

    const innerResults = await Promise.all(nestedExecutions);
    const [succeededInner, failedInner] = partition(
      (res) => res.ok,
      innerResults
    );

    if (failedInner.length > 0) {
      result.ok = false;
    }

    succeededInner.forEach((okResult) => {
      result.data.push(...okResult.data);
    });

    failedInner.forEach((failedResult) => {
      const { errors } = failedResult;

      // add current input to the input stack trace
      errors.forEach((err) => {
        err.inputDataStackTrace.push(input);
      });

      result.errors.push(...errors);
    });

    return result;
  }
}
