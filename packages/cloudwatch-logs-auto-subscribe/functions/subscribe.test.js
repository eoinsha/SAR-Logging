const AWS = require('aws-sdk')

const mockPutSubscriptionFilter = jest.fn()
AWS.CloudWatchLogs.prototype.putSubscriptionFilter = mockPutSubscriptionFilter
const mockDescribeLogGroups = jest.fn()
AWS.CloudWatchLogs.prototype.describeLogGroups = mockDescribeLogGroups
const mockDescribeSubscriptionFilters = jest.fn()
AWS.CloudWatchLogs.prototype.describeSubscriptionFilters = mockDescribeSubscriptionFilters
const mockAddPermission = jest.fn()
AWS.Lambda.prototype.addPermission = mockAddPermission

const destinationArn = 'arn:aws:lambda:us-east-1:123456789:function:boohoo'

process.env.PREFIX = '/aws/lambda/'
process.env.DESTINATION_ARN = destinationArn

beforeEach(() => {
  mockPutSubscriptionFilter.mockReturnValue({
    promise: () => Promise.resolve()
  })

  mockAddPermission.mockReturnValueOnce({
    promise: () => Promise.resolve()
  })
})

afterEach(() => {
  mockPutSubscriptionFilter.mockClear()
  mockDescribeLogGroups.mockClear()
  mockDescribeSubscriptionFilters.mockClear()
})

describe('new log group', () => {
  const event = {
    detail: {
      requestParameters: {
        logGroupName: '/aws/lambda/test-me'
      }
    }
  }
  const handler = require('./subscribe').newLogGroups

  describe('prefix', () => {
    test('log group is subscribed if it matches prefix', async () => {
      await handler(event)

      expect(mockPutSubscriptionFilter).toBeCalled()
    })

    test('log group is not subscribed if it does not match prefix', async () => {
      const event = {
        detail: {
          requestParameters: {
            logGroupName: '/api/gateway/test-me'
          }
        }
      }
      await handler(event)

      expect(mockPutSubscriptionFilter).not.toBeCalled()
    })
  })

  describe('add Lambda permission', () => {
    test('if encounters Lambda permission error, then attempts to add permission before retrying', async () => {
      givenPutFilterFailsWith(
        'InvalidParameterException',
        'Could not execute the lambda function. Make sure you have given CloudWatch Logs permission to execute your function.'
      )

      // succeed when retried
      mockPutSubscriptionFilter.mockReturnValueOnce({
        promise: () => Promise.resolve()
      })

      await handler(event)

      expect(mockAddPermission).toBeCalled()
      expect(mockPutSubscriptionFilter).toBeCalledTimes(2)
    })
  })

  describe('other errors', () => {
    test('it should not handle other errors', async () => {
      givenPutFilterFailsWith('boo', 'hoo')

      await expect(handler(event)).rejects.toThrow()

      expect(mockPutSubscriptionFilter).toBeCalled()
    })
  })
})

describe('existing log group', () => {
  const handler = require('./subscribe').existingLogGroups

  test('', async () => {
    givenDescribeLogGroupsReturns(['group1', 'group2'], true)
    givenDescribeLogGroupsReturns(['group3'])

    givenDescribeFiltersReturns(destinationArn) // group1 (ignored)
    givenDescribeFiltersReturns('some-other-arn') // group2 (replaced)
    givenDescribeFiltersReturns() // group3 (replaced)

    await handler()

    expect(mockPutSubscriptionFilter).toBeCalledTimes(2)
  })
})

const givenPutFilterFailsWith = (code, message) => {
  mockPutSubscriptionFilter.mockReturnValueOnce({
    promise: () => Promise.reject(new AwsError(code, message))
  })
}

const givenDescribeLogGroupsReturns = (logGroups, hasMore = false) => {
  mockDescribeLogGroups.mockReturnValueOnce({
    promise: () => Promise.resolve({
      logGroups: logGroups.map(x => ({ logGroupName: x })),
      nextToken: hasMore ? 'more' : undefined
    })
  })
}

const givenDescribeFiltersReturns = (arn) => {
  const subscriptionFilters = arn ? [{ destinationArn: arn }] : []

  mockDescribeSubscriptionFilters.mockReturnValueOnce({
    promise: () => Promise.resolve({
      subscriptionFilters: subscriptionFilters
    })
  })
}

class AwsError extends Error {
  constructor (code, message) {
    super(message)

    this.code = code
  }
}
