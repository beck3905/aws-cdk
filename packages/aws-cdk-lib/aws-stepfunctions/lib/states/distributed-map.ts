import * as iam from '@aws-cdk/aws-iam';
import { IBucket } from '@aws-cdk/aws-s3';
import { Construct } from 'constructs';
import { Map, MapProps, MapStateMode } from './map';
import { FieldUtils } from '../fields';
import { StateMachineType } from '../state-machine';
import { INextable } from '../types';


/**
 * Base interface for Item Reader configurations
 */
export interface IItemReader {

  /**
   * S3 Bucket containing objects to iterate over or a file with a list to iterate over
   */
  readonly bucket: IBucket

  /**
   * Limits the number of items passed to the Distributed Map state
   *
   * @default - Distribute Map state will iterate over all items provided by the ItemReader
   */
  readonly maxItems?: number

  /**
   * Render the ItemReader as JSON object
   */
  render(): any

  /**
   * Compile policy statements to provide relevent permissions to the state machine
   */
  providePolicyStatements(): iam.PolicyStatement[]
}

/**
 * Base interface for Item Reader configuration properties
 */
interface ItemReaderProps {

  /**
   * S3 Bucket containing objects to iterate over or a file with a list to iterate over
   */
  readonly bucket: IBucket

  /**
   * Limits the number of items passed to the Distributed Map state
   *
   * @default - Distribute Map state will iterate over all items provided by the ItemReader
   */
  readonly maxItems?: number
}

/**
 * Properties for configuring an Item Reader that iterates over objects in an S3 bucket
 */
export interface S3ObjectsItemReaderProps extends ItemReaderProps {

  /**
   * S3 prefix used to limit objects to iterate over
   *
   * @default - No prefix
   */
  readonly prefix?: string

}

/**
 * Item Reader configuration for iterating over objects in an S3 bucket
 */
export class S3ObjectsItemReader implements IItemReader {

  /**
   * S3 Bucket containing objects to iterate over
   */
  readonly bucket: IBucket;

  /**
   * S3 prefix used to limit objects to iterate over
   *
   * @default - No prefix
   */
  readonly prefix?: string

  /**
   * Limits the number of items passed to the Distributed Map state
   *
   * @default - No maxItems
   */
  readonly maxItems?: number;

  /**
   * ARN for the `listObjectsV2` method of the S3 API
   * This API method is used to iterate all objects in the S3 bucket/prefix
   */
  private readonly resource: string = 'arn:aws:states:::s3:listObjectsV2'

  constructor(props: S3ObjectsItemReaderProps) {

    this.bucket = props.bucket;
    this.prefix = props.prefix;
    this.maxItems = props.maxItems;

  }

  /**
   * Renders the ItemReader configuration as JSON object
   * @returns - JSON object
   */
  public render(): any {
    return FieldUtils.renderObject({
      Resource: this.resource,
      Parameters: {
        Bucket: this.bucket.bucketName,
        ...(this.prefix && { Prefix: this.prefix }),
      },
    });
  }

  /**
   * Compile policy statements to provide relevent permissions to the state machine
   */
  public providePolicyStatements(): iam.PolicyStatement[] {
    const resource = `arn:aws:s3:::${this.bucket.bucketName}`;

    return [
      new iam.PolicyStatement({
        actions: [
          's3:ListBucket',
        ],
        resources: [resource],
      }),
    ];
  }
}

/**
 * Base interface for Item Reader configuration properties the iterate over entries in a S3 file
 */
export interface S3ItemReaderProps extends ItemReaderProps {
  /**
   * Key of file stored in S3 bucket containing an array to iterate over
   */
  readonly key: string
}

/**
 * Base Item Reader configuration for iterating over entries in a S3 file
 */
abstract class S3ItemReader implements IItemReader {
  /**
   * S3 Bucket containing a file with a list to iterate over
   */
  readonly bucket: IBucket;

  /**
   * S3 key of a file with a list to iterate over
   */
  readonly key: string

  /**
   * Limits the number of items passed to the Distributed Map state
   *
   * @default - No maxItems
   */
  readonly maxItems?: number;

  protected readonly resource: string = 'arn:aws:states:::s3:getObject'
  protected abstract readonly inputType: string;

  constructor(props: S3ItemReaderProps) {
    this.bucket = props.bucket;
    this.key = props.key;
    this.maxItems = props.maxItems;
  }

  /**
   * Renders the ItemReader configuration as JSON object
   * @returns - JSON object
   */
  public render(): any {
    return FieldUtils.renderObject({
      Resource: this.resource,
      ReaderConfig: {
        InputType: this.inputType,
      },
      Parameters: {
        Bucket: this.bucket.bucketName,
        Key: this.key,
      },
    });
  }

  /**
   * Compile policy statements to provide relevent permissions to the state machine
   */
  public providePolicyStatements(): iam.PolicyStatement[] {

    const resource = `arn:aws:s3:::${this.bucket.bucketName}/*`;

    return [
      new iam.PolicyStatement({
        actions: [
          's3:GetObject',
        ],
        resources: [resource],
      }),
    ];
  }

}

/**
 * Item Reader configuration for iterating over items in a JSON array stored in a S3 file
 */
export class S3JsonItemReader extends S3ItemReader {

  protected readonly inputType: string = 'JSON';

}

/**
 * CSV header location options
 */
export enum CsvHeaderLocation {
  /**
   * Headers will be read from first row of CSV file
   */
  FIRST_ROW = 'FIRST_ROW',
  /**
   * Headers are provided in CSVHeaders property
   */
  GIVEN = 'GIVEN'
}

/**
 * Configuration for CSV header options for a CSV Item Reader
 */
export class CsvHeaders {

  /**
   * Configures S3CsvItemReader to read headers from the first row of the CSV file
   * @returns - CsvHeaders
   */
  public static useFirstRow(): CsvHeaders {
    return new CsvHeaders(CsvHeaderLocation.FIRST_ROW);
  }

  /**
   * Configures S3CsvItemReader to use the headers provided in the `headers` parameter
   * @param headers - List of headers
   * @returns - CsvHeaders
   */
  public static use(headers: string[]): CsvHeaders {
    return new CsvHeaders(CsvHeaderLocation.GIVEN, headers);
  }

  /**
   * Location of headers in CSV file
   */
  public readonly headerLocation: CsvHeaderLocation;

  /**
   * List of headers if `headerLocation` is `GIVEN`
   */
  public readonly headers?: string[];

  private constructor(headerLocation: CsvHeaderLocation, headers?: string[]) {
    this.headerLocation = headerLocation;
    this.headers = headers;
  }
}

/**
 * Properties for configuring an Item Reader that iterates over items in a CSV file in S3
 */
export interface S3CsvItemReaderProps extends S3ItemReaderProps {
  /**
   * CSV file header configuration
   */
  readonly csvHeaders: CsvHeaders
}

/**
 * Item Reader configuration for iterating over items in a CSV file stored in S3
 */
export class S3CsvItemReader extends S3ItemReader {

  /**
   * CSV headers configuration
   */
  readonly csvHeaders: CsvHeaders
  protected readonly inputType: string = 'CSV';

  constructor(props: S3CsvItemReaderProps) {
    super(props);
    this.csvHeaders = props.csvHeaders;
  }

  public render(): any {

    let rendered = super.render();

    rendered.ReaderConfig = FieldUtils.renderObject({
      ...rendered.ReaderConfig,
      ...{
        CSVHeaderLocation: this.csvHeaders.headerLocation,
        ...(this.csvHeaders.headers && { CSVHeaders: this.csvHeaders.headers }),
      },
    });

    return rendered;

  }
}

/**
 * Item Reader configuration for iterating over items in a S3 inventory manifest file stored in S3
 */
export class S3ManifestItemReader extends S3ItemReader {

  protected readonly inputType: string = 'MANIFEST';

}

/**
 * Interface for Result Writer configuration properties
 */
export interface ResultWriterProps {
  /**
   * S3 Bucket in which to save Map Run results
   */
  readonly bucket: IBucket

  /**
   * S3 prefix in which to save Map Run results
   *
   * @default - No prefix
   */
  readonly prefix?: string
}

/**
 * Configuration for writing Distributed Map state results to S3
 */
export class ResultWriter {

  /**
   * S3 Bucket in which to save Map Run results
   */
  readonly bucket: IBucket

  /**
   * S3 prefix in which to save Map Run results
   *
   * @default - No prefix
   */
  readonly prefix?: string

  constructor(props: ResultWriterProps) {
    this.bucket = props.bucket;
    this.prefix = props.prefix;
  }

  /**
   * Render ResultWriter in ASL JSON format
   */
  public render(): any {
    return FieldUtils.renderObject({
      Resource: 'arn:aws:states:::s3:putObject',
      Parameters: {
        Bucket: this.bucket.bucketName,
        ...(this.prefix && { Prefix: this.prefix }),
      },
    });
  }

  /**
   * Compile policy statements to provide relevent permissions to the state machine
   */
  public providePolicyStatements(): iam.PolicyStatement[] {

    const resource = `arn:aws:s3:::${this.bucket.bucketName}/*`;

    return [
      new iam.PolicyStatement({
        actions: [
          's3:PutObject',
          's3:GetObject',
          's3:ListMultipartUploadParts',
          's3:AbortMultipartUpload',
        ],
        resources: [resource],
      }),
    ];
  }
}

/**
 * Percentage of failed items to tolerate in a Map Run
 */
export class ToleratedFailurePercentage {

  /**
   * Fill value from JSON path
   */
  public static fromPath(path: string): ToleratedFailurePercentage {
    return new ToleratedFailurePercentage(path, true);
  }

  /**
   * Fill value from number
   */
  public static fromNumber(value: number): ToleratedFailurePercentage {
    return new ToleratedFailurePercentage(value);
  }

  /**
   * Number value or string JSON path
   */
  private readonly value: any;

  /**
   * Is the value a string JSON path
   */
  private readonly fromPath?: boolean

  private constructor(value: any, fromPath?: boolean) {
    this.value = value;
    this.fromPath = fromPath;
  }

  /**
   * Renders the value as ASL JSON
   */
  public render(): any {
    return {
      [(this.fromPath ? 'ToleratedFailurePercentagePath' : 'ToleratedFailurePercentage')]: this.value,
    };
  }
}

/**
 * Number of failed items to tolerate in a Map Run
 */
export class ToleratedFailureCount {

  /**
   * Fill value from JSON path
   */
  public static fromPath(path: string): ToleratedFailureCount {
    return new ToleratedFailureCount(path, true);
  }

  /**
   * Fill value from number
   */
  public static fromNumber(value: number): ToleratedFailureCount {
    return new ToleratedFailureCount(value);
  }

  /**
   * Number value or string JSON path
   */
  private readonly value: any;

  /**
   * Is the value a string JSON path
   */
  private readonly fromPath?: boolean

  private constructor(value: any, fromPath?: boolean) {
    this.value = value;
    this.fromPath = fromPath;
  }

  /**
   * Renders the value as ASL JSON
   */
  public render(): any {
    return {
      [(this.fromPath ? 'ToleratedFailureCountPath' : 'ToleratedFailureCount')]: this.value,
    };
  }
}

/**
 * Maximum number of items that each child workflow execution processes
 */
export class MaxItemsPerBatch {

  /**
   * Fill value from JSON path
   */
  public static fromPath(path: string): MaxItemsPerBatch {
    return new MaxItemsPerBatch(path, true);
  }

  /**
   * Fill value from number
   */
  public static fromNumber(value: number): MaxItemsPerBatch {
    return new MaxItemsPerBatch(value);
  }

  /**
   * Number value or string JSON path
   */
  private readonly value: any;

  /**
   * Is the value a string JSON path
   */
  private readonly fromPath?: boolean

  private constructor(value: any, fromPath?: boolean) {
    this.value = value;
    this.fromPath = fromPath;
  }

  /**
   * Renders the value as ASL JSON
   */
  public render(): any {
    return {
      [(this.fromPath ? 'MaxItemsPerBatchPath' : 'MaxItemsPerBatch')]: this.value,
    };
  }
}

/**
 * Maximum number of bytes that each child workflow execution processes
 */
export class MaxInputBytesPerBatch {

  /**
   * Fill value from JSON path
   */
  public static fromPath(path: string): MaxInputBytesPerBatch {
    return new MaxInputBytesPerBatch(path, true);
  }

  /**
   * Fill value from number
   */
  public static fromNumber(value: number): MaxInputBytesPerBatch {
    return new MaxInputBytesPerBatch(value);
  }

  /**
   * Number value or string JSON path
   */
  private readonly value: any;

  /**
   * Is the value a string JSON path
   */
  private readonly fromPath?: boolean

  private constructor(value: any, fromPath?: boolean) {
    this.value = value;
    this.fromPath = fromPath;
  }

  /**
   * Renders the value as ASL JSON
   */
  public render(): any {
    return {
      [(this.fromPath ? 'MaxInputBytesPerBatchPath' : 'MaxInputBytesPerBatch')]: this.value,
    };
  }
}

/**
 * Properties for configuring a Distribute Map state
 */
export interface DistributedMapProps extends MapProps {

  /**
     * MapExecutionType
     *
     * The execution type of the distributed map state
     *
     * @default StateMachineType.STANDARD
     */
  readonly mapExecutionType?: StateMachineType

  /**
     * ItemReader
     *
     * Configuration for where to read items dataset in S3 to iterate
     *
     * @default - No itemReader
     */
  readonly itemReader?: IItemReader

  /**
     * ToleratedFailurePercentage
     *
     * Percentage of failed items to tolerate in a Map Run
     *
     * Supports a static number or a JsonPath to a field containing the number value
     *
     * @default - No toleratedFailurePercentage
     */
  readonly toleratedFailurePercentage?: ToleratedFailurePercentage

  /**
     * ToleratedFailureCount
     *
     * Number of failed items to tolerate in a Map Run
     *
     * Supports a static number or a JsonPath to a field containing the number value
     *
     * @default - No toleratedFailureCount
     */
  readonly toleratedFailureCount?: ToleratedFailureCount

  /**
     * Label
     *
     * Unique name for the Distributed Map state added to each Map Run
     *
     * @default - No label
     */
  readonly label?: string

  /**
   * MaxItemsPerBatch
   *
   * Specifies the maximum number of items that each child workflow execution processes
   *
   * Supports a static number or a JsonPath to a field containing the number value
   *
   * @default - No maxItemsPerBatch
   */
  readonly maxItemsPerBatch?: MaxItemsPerBatch

  /**
   * MaxInputBytesPerBatch
   *
   * Specifies the maximum number of bytes that each child workflow execution processes
   *
   * Supports a static number or a JsonPath to a field containing the number value
   *
   * @default - No maxInputBytesPerBatch
   */
  readonly maxInputBytesPerBatch?: MaxInputBytesPerBatch

  /**
   * BatchInput
   *
   * Fixed JSON input to include in each batch passed to each child workflow execution
   *
   * @default - No batchInput
   */
  readonly batchInput?: object

  /**
   * Configuration for S3 location in which to save Map Run results
   *
   * @default - No resultWriter
   */
  readonly resultWriter?: ResultWriter
}

/**
 * Define a Distributed Mode Map state in the state machine
 *
 * A `Map` state can be used to run a set of steps for each element of an input array.
 * A Map state will execute the same steps for multiple entries of an array in the state input.
 *
 * While the Parallel state executes multiple branches of steps using the same input, a Map state
 * will execute the same steps for multiple entries of an array in the state input.
 *
 * A `Map` state in `Distributed` mode will execute a child workflow for each iteration of the Map state.
 * This serves to increase concurrency and allows for larger workloads to be run in a single state machine.
 * @see https://docs.aws.amazon.com/step-functions/latest/dg/concepts-asl-use-map-state-distributed.html
 */
export class DistributedMap extends Map implements INextable {

  protected readonly mode: MapStateMode = MapStateMode.DISTRIBUTED;

  private readonly mapExecutionType?: StateMachineType;
  private readonly itemReader?: IItemReader;
  private readonly toleratedFailurePercentage?: ToleratedFailurePercentage;
  private readonly toleratedFailureCount?: ToleratedFailureCount;
  private readonly label?: string;
  private readonly maxItemsPerBatch?: MaxItemsPerBatch;
  private readonly maxInputBytesPerBatch?: MaxInputBytesPerBatch;
  private readonly batchInput?: object;
  private readonly resultWriter?: ResultWriter;

  constructor(scope: Construct, id: string, props: DistributedMapProps = {}) {
    super(scope, id, props);
    this.mapExecutionType = props.mapExecutionType ?? StateMachineType.STANDARD;
    this.itemReader = props.itemReader;
    this.toleratedFailurePercentage = props.toleratedFailurePercentage;
    this.toleratedFailureCount = props.toleratedFailureCount;
    this.label = props.label;
    this.maxItemsPerBatch = props.maxItemsPerBatch;
    this.maxInputBytesPerBatch = props.maxInputBytesPerBatch;
    this.batchInput = props.batchInput;
    this.resultWriter = props.resultWriter;
  }

  /**
   * Validate this state
   */
  protected validateState(): string[] {
    const errors: string[] = super.validateState();

    if (this.itemsPath !== undefined && this.itemReader !== undefined) {
      errors.push('Provide either `itemsPath` or `itemReader`, but not both');
    }

    if (this.label !== undefined) {
      if (this.label.length > 40) {
        errors.push('label must be 40 characters or less');
      }

      let labelRegex = new RegExp('[\s\?\*\<\>\{\}\\[\\]\:\;\,\\\|\^\~\$\#\%\&\`\"]|[\u0000-\u001f]|[\u007f-\u009f]', 'gi');
      if (labelRegex.test(this.label)) {
        errors.push('label cannot contain any whitespace or special characters');
      }
    }

    return errors;
  }

  /**
   * Return the Amazon States Language object for this state
   */
  public toStateJson(): object {
    let rendered: any = super.toStateJson();
    if (this.mapExecutionType) {
      rendered.ItemProcessor.ProcessorConfig.ExecutionType = this.mapExecutionType;
    }

    return {
      ...rendered,
      ...this.renderItemReader(),
      ...this.renderItemBatcher(),
      ...this.toleratedFailurePercentage?.render(),
      ...this.toleratedFailureCount?.render(),
      ...(this.label && { Label: this.label }),
      ...this.renderResultWriter(),
    };
  }

  /**
   * Render the ItemReader as JSON object
   */
  private renderItemReader(): any {
    if (this.itemReader === undefined) { return undefined; }

    this.itemReader.providePolicyStatements().forEach((statement) => {
      this.iteration?.registerPolicyStatement(statement);
    });

    return FieldUtils.renderObject({
      ItemReader: this.itemReader.render(),
    });
  }

  /**
   * Render ResultWriter in ASL JSON format
   */
  private renderResultWriter(): any {
    if (this.resultWriter === undefined) { return undefined; }

    this.resultWriter.providePolicyStatements().forEach((statement) => {
      this.iteration?.registerPolicyStatement(statement);
    });

    return FieldUtils.renderObject({
      ResultWriter: this.resultWriter.render(),
    });
  }

  /**
   * Render ItemBatcher in ASL JSON format
   */
  private renderItemBatcher(): any {
    if (this.maxItemsPerBatch === undefined && this.maxInputBytesPerBatch === undefined && this.batchInput === undefined) { return undefined; }

    return {
      ItemBatcher: {
        ...this.maxItemsPerBatch?.render(),
        ...this.maxInputBytesPerBatch?.render(),
        ...(this.batchInput && { BatchInput: this.batchInput }),
      },
    };
  }
}